/**
 * J14-75 Intelligent Agent — powered by Arc App Kit + DeepSeek LLM
 *
 * Execution pipeline:
 *   1. DeepSeek LLM                → parse user intent → strict JSON
 *   2. Smart routing               → transfer/bridge/swap/query
 *   3. App Kit send/bridge/swap    → real on-chain execution
 *      – kit.send()   for transfers on Arc Testnet
 *      – kit.bridge() for cross-chain USDC via CCTP
 *      – kit.swap()   for mainnet token swaps (Gas Station for email users)
 *   4. Returns real txHash + explorer URL (zero hallucinations)
 *
 * Adapter: @circle-fin/adapter-circle-wallets
 *   – Circle Developer-Controlled Wallets
 *   – CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET env vars
 *   – DeepSeek API for intent analysis (DEEPSEEK_API_KEY)
 */
import { formatUnits, parseUnits, Address, erc20Abi } from "viem";
import { arcTestnet } from "viem/chains";
import { createPublicClient, http } from "viem";

// App Kit
import {
  kit,
  getOrCreateAgentWallet,
  appKitSend,
  appKitBridge,
  appKitSwap,
  resolveChain,
} from "../lib/app-kit.js";

// Blockscout helpers
import {
  fetchTokenBalances,
  fetchTransactionHistory,
} from "../lib/circle-client.js";

// ──────────────────────────────────────────────────────────────────────────────
// LLM API Helper - Uses Replit's built-in AI or configurable endpoint
// ──────────────────────────────────────────────────────────────────────────────
async function callLLM(
  messages: Array<{ role: "system" | "user"; content: string }>,
  options?: { json_mode?: boolean }
): Promise<string> {
  // Try Replit's built-in AI API first (available when running on Replit)
  const replitApiUrl = process.env.REPLIT_AI_API_URL || "https://replit.com/ai/api/chat";
  
  try {
    // Option 1: Replit AI API (when running on Replit)
    const res = await fetch(replitApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages,
        temperature: 0.3,
        max_tokens: 2048,
        ...(options?.json_mode && { response_format: { type: "json_object" } }),
      }),
    });

    if (res.ok) {
      const data = await res.json() as any;
      return data.choices?.[0]?.message?.content ?? data.response ?? "";
    }
    
    // Fallback: Use simple rule-based parsing if no LLM available
    console.warn("⚠️ LLM API unavailable, using fallback parsing");
    return simpleIntentParse(messages[messages.length - 1]?.content || "");
  } catch (err: any) {
    console.warn("⚠️ LLM call failed:", err.message);
    // Fallback to simple parsing
    return simpleIntentParse(messages[messages.length - 1]?.content || "");
  }
}

// Simple rule-based intent parsing fallback
function simpleIntentParse(message: string): string {
  const lower = message.toLowerCase();
  const amountMatch = lower.match(/(\d+(?:\.\d+)?)/);
  const addressMatch = message.match(/0x[a-fA-F0-9]{40}/);
  const amount = amountMatch ? Number(amountMatch[1]) : 1;
  
  // Check for transfer intent
  if (lower.includes("send") || lower.includes("transfer") || lower.includes("pay")) {
    return JSON.stringify({
      taskTypes: ["transfer"],
      entities: {
        tokens: [lower.includes("eurc") ? "EURC" : "USDC"],
        amounts: [amount],
        addresses: addressMatch ? [addressMatch[0]] : [],
      },
      isScheduled: false
    });
  }
  
  // Check for bridge intent
  if (lower.includes("bridge") || lower.includes("cctp")) {
    return JSON.stringify({
      taskTypes: ["bridge"],
      entities: { tokens: ["USDC"], toChain: "Ethereum" },
      isScheduled: false
    });
  }
  
  // Check for swap intent
  if (lower.includes("swap") || lower.includes("exchange")) {
    return JSON.stringify({
      taskTypes: ["swap"],
      entities: { tokenIn: "USDT", tokenOut: "USDC" },
      isScheduled: false
    });
  }
  
  // Check for balance intent
  if (lower.includes("balance") || lower.includes("how much") || lower.includes("check")) {
    return JSON.stringify({
      taskTypes: ["query"],
      entities: {},
      isScheduled: false
    });
  }
  
  // Default: query
  return JSON.stringify({
    taskTypes: ["query"],
    entities: {},
    isScheduled: false
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Arc Testnet public client (for balance validation only)
// ──────────────────────────────────────────────────────────────────────────────
const arcClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

// ──────────────────────────────────────────────────────────────────────────────
// Known tokens on Arc Testnet
// ──────────────────────────────────────────────────────────────────────────────
// IMPORTANT: Arc Testnet USDC duality:
// - Native gas token: 18 decimals (for getBalance, gas estimation)
// - ERC-20 operations: 6 decimals (for balanceOf, transfer, approve)
// See: use-usdc skill for details
const KNOWN_TOKENS: Record<
  string,
  { 
    address: string; 
    symbol: string;
    // Different decimals for different contexts
    nativeDecimals: number;  // For getBalance (native gas)
    erc20Decimals: number;   // For balanceOf, transfer, approve (ERC-20)
  }
> = {
  USDC: { 
    address: process.env.ARC_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000",
    symbol: "USDC",
    nativeDecimals: 18,  // Native gas uses 18 decimals
    erc20Decimals: 6,    // ERC-20 operations use 6 decimals
  },
  EURC: {
    address: process.env.ARC_EURC_ADDRESS ?? "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    symbol: "EURC",
    nativeDecimals: 6,
    erc20Decimals: 6,
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Scheduled tasks (in-memory)
// ──────────────────────────────────────────────────────────────────────────────
const scheduledTasks = new Map<
  string,
  { id: string; type: string; trigger: string; status: string; createdAt: Date }
>();

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────
export interface TaskContext {
  userAddress: string;
  message: string;
  chainId: number;
  isEmailUser?: boolean; // true → Gas Station sponsorship enabled
}

export interface TaskResult {
  success: boolean;
  message: string;
  txHash?: string;
  taskId?: string;
  isScheduled?: boolean;
}

interface AIAnalysis {
  taskTypes: string[];
  entities: {
    addresses?: string[];
    amounts?: number[];
    tokens?: string[];
    tokenIn?: string;
    tokenOut?: string;
    toChain?: string;
    fromChain?: string;
    swapChain?: string;
  };
  isScheduled: boolean;
  scheduleTrigger?: string | null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Agent
// ──────────────────────────────────────────────────────────────────────────────
export class IntelligentAgent {
  // ─────────────────────────────────────────────────────────────────────────
  // Entry point
  // ─────────────────────────────────────────────────────────────────────────
  async processComplexTask(context: TaskContext): Promise<TaskResult> {
    try {
      const msg = context.message;
      const lower = msg.toLowerCase();
      console.log(`\n🤖 Agent: "${msg}"`);

      // ── Fast-path: balance ─────────────────────────────────────────────
      if (
        lower.includes("balance") ||
        lower.includes("how much") ||
        (lower.includes("token") &&
          !lower.includes("transfer") &&
          !lower.includes("send") &&
          !lower.includes("swap"))
      ) {
        console.log("💰 Fast-path: balance → Blockscout");
        return { success: true, message: await fetchTokenBalances(context.userAddress) };
      }

      // ── Fast-path: transaction history ─────────────────────────────────
      if (
        lower.includes("history") ||
        lower.includes("recent tx") ||
        lower.includes("past transaction") ||
        (lower.includes("transaction") && !lower.includes("transfer"))
      ) {
        console.log("📜 Fast-path: history → Blockscout");
        return { success: true, message: await fetchTransactionHistory(context.userAddress) };
      }

      // ── Step 1: LLM intent parse ──────────────────────────────────────
      const analysis = await this.analyzeWithGroq(msg);
      console.log("🔍 Intent:", JSON.stringify(analysis));

      // ── Impossible tasks ───────────────────────────────────────────────
      if (analysis.taskTypes.includes("impossible")) {
        return {
          success: false,
          message:
            "❌ This task cannot be completed on Arc Testnet with the current configuration. Please check that required tokens or contracts exist.",
        };
      }

      // ── Scheduled tasks ────────────────────────────────────────────────
      if (analysis.isScheduled && analysis.scheduleTrigger) {
        return {
          success: false,
          message:
            "❌ Scheduled execution is not enabled in this deployment. Please submit the transaction when you want it executed.",
        };
      }

      // ── Route to executor ──────────────────────────────────────────────
      return await this.route(analysis, context);
    } catch (err: any) {
      console.error("❌ Agent error:", err);
      return {
        success: false,
        message: `🚨 ${err instanceof Error ? err.message : "Unknown error"}`,
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LLM: parse intent to JSON
  // ─────────────────────────────────────────────────────────────────────────
  private async analyzeWithGroq(message: string): Promise<AIAnalysis> {
    const content = await callLLM(
      [
        {
          role: "system",
                    content: `You are J14-75, the best Web3 AI agent on Arc Testnet.
You can detect ANY ERC-20 token using Blockscout API.
Supported actions: transfer, bridge (USDC via CCTP), swap any token, balance check, history, query.
Always return ONLY valid JSON. No extra text.
For swap: set tokenIn, tokenOut, amounts[0] as amountIn.
Never mark normal tasks as "impossible".
Output schema is same as before.`,
        },
        { role: "user", content: message },
      ],
      { json_mode: true }
    );

    try {
      if (!content || content.trim() === "") {
        console.warn("⚠️ LLM returned empty response, treating as query");
        return { taskTypes: ["query"], entities: {}, isScheduled: false };
      }
      const parsed = JSON.parse(content) as AIAnalysis;
      // Ensure taskTypes is never empty
      if (!parsed.taskTypes || parsed.taskTypes.length === 0) {
        parsed.taskTypes = ["query"];
      }
      return parsed;
    } catch (err) {
      console.warn("⚠️ LLM JSON parse failed:", content);
      return { taskTypes: ["query"], entities: {}, isScheduled: false };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Route to the right executor
  // ─────────────────────────────────────────────────────────────────────────
  private async route(
    analysis: AIAnalysis,
    context: TaskContext
  ): Promise<TaskResult> {
    const types = analysis.taskTypes;

    if (types.includes("swap")) {
      return this.executeSwap(analysis.entities, context);
    }

    if (types.includes("transfer") || types.includes("batch")) {
      return this.executeTransfer(analysis.entities, context);
    }

    if (types.includes("bridge")) {
      return this.executeBridge(analysis.entities, context);
    }

    // General query
    return this.handleQuery(context.message);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TRANSFER — kit.send()
  // ─────────────────────────────────────────────────────────────────────────
  private async executeTransfer(
    entities: AIAnalysis["entities"],
    context: TaskContext
  ): Promise<TaskResult> {
    const addresses = entities.addresses ?? [];
    const amounts = entities.amounts ?? [];
    const token = (entities.tokens?.[0] ?? "USDC").toUpperCase();

    if (addresses.length === 0 || amounts.length === 0) {
      return {
        success: false,
        message:
          "❌ Transfer requires at least one recipient address and an amount.\n\nExample: 'Send 5 USDC to 0x1234...'",
      };
    }

    const tokenInfo = KNOWN_TOKENS[token];
    if (!tokenInfo) {
      return {
        success: false,
        message: `❌ Unsupported token: ${token}. Arc Testnet supports USDC and EURC only.`,
      };
    }
    // Get the agent's Circle wallet
        // PERMANENT: User's actual Circle wallet is being used (wallet connect or email for both)
    const { circleAddress } = await getOrCreateAgentWallet(context.userAddress);
    console.log(`✅ REAL USER WALLET MAPPED → User: ${context.userAddress} | Circle: ${circleAddress} | EmailUser: ${context.isEmailUser}`);

    // Validate total balance before attempting
    const totalAmount = amounts.reduce((s, a) => s + a, 0);
    await this.assertBalance(circleAddress, token, totalAmount);

    // Single transfer
    if (addresses.length === 1) {
      const recipient = addresses[0];
      const amount = amounts[0].toFixed(6);

      console.log(`💸 kit.send(): ${amount} ${token} → ${recipient}`);
      const { txHash, explorerUrl } = await appKitSend({
        circleAddress,
        recipient,
        amount,
        token,
      });

      return {
        success: true,
        message: `✅ Transfer complete!\n• Amount: ${amount} ${token}\n• To: ${recipient}\n• TxHash: ${txHash}\n• Explorer: ${explorerUrl}`,
        txHash,
      };
    }

    // Batch transfers — sequential via kit.send()
    const logs: string[] = [];
    let lastTxHash = "";

    for (let i = 0; i < addresses.length; i++) {
      const recipient = addresses[i];
      const amount = (amounts[i] ?? amounts[0]).toFixed(6);

      console.log(`📦 Batch [${i + 1}/${addresses.length}]: ${amount} ${token} → ${recipient}`);
      const { txHash } = await appKitSend({ circleAddress, recipient, amount, token });
      logs.push(`  [${i + 1}] ${recipient.slice(0, 10)}... → ${amount} ${token} | tx: ${txHash.slice(0, 14)}...`);
      lastTxHash = txHash;
    }

    return {
      success: true,
      message: `✅ Batch complete! ${addresses.length} transfers:\n${logs.join("\n")}\n\nAll confirmed on Arc Testnet.`,
      txHash: lastTxHash,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BRIDGE — kit.bridge()
  // ─────────────────────────────────────────────────────────────────────────
  private async executeBridge(
    entities: AIAnalysis["entities"],
    context: TaskContext
  ): Promise<TaskResult> {
    const token = (entities.tokens?.[0] ?? "USDC").toUpperCase();
    const amount = entities.amounts?.[0];
    const toChain = entities.toChain ?? "Arc_Testnet";
    const fromChain = entities.fromChain ?? "Arc_Testnet";

    if (token !== "USDC") {
      return {
        success: false,
        message: `❌ Only USDC can be bridged via CCTP. ${token} bridging is not supported.`,
      };
    }

    if (!amount) {
      return {
        success: false,
        message: "❌ Bridge requires an amount. Example: 'Bridge 5 USDC to Ethereum Sepolia'",
      };
    }

    const toChainId = resolveChain(toChain);
    const fromChainId = resolveChain(fromChain);

    // Resolve arc side
    const isArcSource = fromChainId === "Arc_Testnet";
    const isArcDest = toChainId === "Arc_Testnet";

    if (!isArcSource && !isArcDest) {
      return {
        success: false,
        message:
          "❌ At least one chain must be Arc Testnet. Use Arc Testnet as either the source or destination.",
      };
    }

        // PERMANENT: User's actual Circle wallet is being used (wallet connect or email for both)
    const { circleAddress } = await getOrCreateAgentWallet(context.userAddress);
    console.log(`✅ REAL USER WALLET MAPPED → User: ${context.userAddress} | Circle: ${circleAddress} | EmailUser: ${context.isEmailUser}`);

    // Validate balance if sending from Arc
    if (isArcSource) {
      await this.assertBalance(circleAddress, "USDC", amount);
    }

    console.log(`🌉 kit.bridge(): ${amount} USDC | ${fromChainId} → ${toChainId}`);
    const { txHash, steps } = await appKitBridge({
      circleAddress,
      fromChain: fromChainId,
      toChain: toChainId,
      amount: amount.toFixed(6),
    });

    const stepSummary = steps
      .map(
        (s: any) =>
          `  • ${s.name ?? "step"}: ${s.state ?? "?"} | ${s.txHash?.slice(0, 14) ?? ""}...`
      )
      .join("\n");

    return {
      success: true,
      message: `✅ Bridge complete!\n• ${amount} USDC | ${fromChainId} → ${toChainId}\n• TxHash: ${txHash}\n• Explorer: https://testnet.arcscan.app/tx/${txHash}\n\nSteps:\n${stepSummary}`,
      txHash,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SWAP — kit.swap()
  // Swap is mainnet-only per Arc docs. We route swap requests to mainnet
  // chains. The user should specify which chain (defaults to Ethereum mainnet).
  // Gas Station policy is attached when isEmailUser=true.
  // ─────────────────────────────────────────────────────────────────────────
  private async executeSwap(
    entities: AIAnalysis["entities"],
    context: TaskContext
  ): Promise<TaskResult> {
    const tokenIn = entities.tokenIn ?? entities.tokens?.[0] ?? "USDT";
    const tokenOut = entities.tokenOut ?? entities.tokens?.[1] ?? "USDC";
    const amountIn = entities.amounts?.[0];
    const swapChain = entities.swapChain ?? "Ethereum";

    if (!amountIn) {
      return {
        success: false,
        message: "❌ Swap requires an amount. Example: 'Swap 10 USDT for USDC on Ethereum'",
      };
    }

        // PERMANENT: User's actual Circle wallet is being used (wallet connect or email for both)
    const { circleAddress } = await getOrCreateAgentWallet(context.userAddress);
    console.log(`✅ REAL USER WALLET MAPPED → User: ${context.userAddress} | Circle: ${circleAddress} | EmailUser: ${context.isEmailUser}`);

    const gasSponsorPolicyId = context.isEmailUser
      ? (process.env.GAS_STATION_POLICY_ID ?? undefined)
      : undefined;

    if (gasSponsorPolicyId) {
      console.log(`⛽ Gas Station sponsorship enabled: policyId=${gasSponsorPolicyId}`);
    }

    console.log(`🔄 kit.swap(): ${amountIn} ${tokenIn} → ${tokenOut} on ${swapChain}`);
    const { txHash, steps } = await appKitSwap({
      circleAddress,
      chain: swapChain,
      tokenIn: tokenIn.toUpperCase(),
      tokenOut: tokenOut.toUpperCase(),
      amountIn: amountIn.toFixed(6),
    });

    const stepSummary = steps
      .map((s: any) => `  • ${s.name ?? "step"}: ${s.state ?? "?"} | ${s.txHash?.slice(0, 14) ?? "n/a"}`)
      .join("\n");

    const explorerUrl = txHash ? `https://etherscan.io/tx/${txHash}` : "";

    return {
      success: true,
      message: `✅ Swap complete!\n• ${amountIn} ${tokenIn.toUpperCase()} → ${tokenOut.toUpperCase()} on ${swapChain}\n• TxHash: ${txHash}\n• Explorer: ${explorerUrl}${gasSponsorPolicyId ? "\n• ⛽ Gas sponsored via Circle Gas Station" : ""}\n\nSteps:\n${stepSummary}`,
      txHash,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // General query — LLM answers conversationally
  // ─────────────────────────────────────────────────────────────────────────
  private async handleQuery(message: string): Promise<TaskResult> {
    try {
      const response = await callLLM(
        [
          {
            role: "system",
            content: `You are J14-75, a Web3 AI assistant powered by the Arc App Kit.
You execute real on-chain transactions: send USDC/EURC on Arc Testnet, bridge USDC cross-chain via CCTP, and swap tokens on mainnet chains using kit.swap().
Email-authenticated users get gas-sponsored transactions via Circle Gas Station.
Never hallucinate transaction data. Be concise and helpful.`,
          },
          { role: "user", content: message },
        ]
      );

      return {
        success: true,
        message:
          response ||
          "I can send tokens, check balances, and bridge USDC on Arc Testnet. What would you like to do?",
      };
    } catch (err: any) {
      console.error("❌ LLM query error:", err);
      return {
        success: true,
        message: "I can send tokens, check balances, and bridge USDC on Arc Testnet. What would you like to do?",
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Balance validation (checks the agent's Circle wallet on-chain)
  // ─────────────────────────────────────────────────────────────────────────
  // NOTE: Arc USDC duality - native uses 18 decimals, ERC-20 uses 6 decimals
  // For transfers, we use ERC-20 decimals (6) as that's how USDC is transferred
  private async assertBalance(
    address: string,
    token: string,
    requiredAmount: number
  ): Promise<void> {
    const tokenInfo = KNOWN_TOKENS[token];
    if (!tokenInfo) return;

    let balance: bigint;
    // Use ERC-20 decimals for balance validation (USDC = 6, not 18)
    const decimals = tokenInfo.erc20Decimals;

    try {
      if (tokenInfo.address !== "EURC_NOT_DEPLOYED") {
        balance = (await arcClient.readContract({
          address: tokenInfo.address as Address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address as Address],
        })) as bigint;
      } else {
        return; // Can't validate — skip
      }

      const required = parseUnits(requiredAmount.toString(), decimals);
      const have = parseFloat(formatUnits(balance, decimals));

                        if (balance < required) {
        throw new Error(
          `❌ Insufficient ${token} balance in your wallet.\n` +
          `You have ${have.toFixed(4)} ${token} but need ${requiredAmount}.\n\n` +
          `Please add funds to: ${address}\n` +
          `After funding, try the transaction again.`
        );
                      }
    } catch (err: any) {
      if (err.message?.includes("Insufficient")) throw err;
      console.warn(`⚠️ Balance check skipped: ${err.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Scheduled task accessors
  // ─────────────────────────────────────────────────────────────────────────
  public getScheduledTask(taskId: string) {
    return scheduledTasks.get(taskId);
  }

  public getScheduledTasks() {
    return Array.from(scheduledTasks.values());
  }
}
