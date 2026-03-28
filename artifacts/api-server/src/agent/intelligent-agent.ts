/**
 * J14-75 Intelligent Agent — powered by Arc App Kit
 *
 * Execution pipeline:
 *   1. Groq llama-3.3-70b-versatile  → parse user intent → strict JSON
 *   2. Fast-path shortcuts           → Blockscout API for balance/history
 *   3. App Kit send/bridge           → real on-chain execution
 *      – kit.send()   for transfers on Arc Testnet
 *      – kit.bridge() for cross-chain USDC via CCTP
 *      – kit.swap()   NOT supported on Arc Testnet (documented testnet limitation)
 *   4. Returns real txHash + Arcscan explorer URL (zero hallucinations)
 *
 * Adapter: @circle-fin/adapter-circle-wallets
 *   – Circle Developer-Controlled Wallets (no raw private keys in code)
 *   – CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET env vars
 *
 * Blockchain data: ArcscanAPI (Blockscout) via BLOCKSCOUT_API_KEY env var
 */

import Groq from "groq-sdk";
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
// Groq
// ──────────────────────────────────────────────────────────────────────────────
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
const KNOWN_TOKENS: Record<
  string,
  { address: string; decimals: number; symbol: string }
> = {
  USDC: { address: "native", decimals: 18, symbol: "USDC" },
  EURC: {
    address: process.env.ARC_EURC_ADDRESS ?? "EURC_NOT_DEPLOYED",
    decimals: 6,
    symbol: "EURC",
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

      // ── Step 1: Groq intent parse ──────────────────────────────────────
      const analysis = await this.analyzeWithGroq(msg);
      console.log("🔍 Groq:", JSON.stringify(analysis));

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
        const taskId = `task_${Date.now()}`;
        scheduledTasks.set(taskId, {
          id: taskId,
          type: analysis.taskTypes[0] ?? "unknown",
          trigger: analysis.scheduleTrigger,
          status: "active",
          createdAt: new Date(),
        });
        return {
          success: true,
          message: `⏰ Scheduled! ID: ${taskId}\nWill execute when: ${analysis.scheduleTrigger}`,
          taskId,
          isScheduled: true,
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
  // Groq: parse intent to JSON
  // ─────────────────────────────────────────────────────────────────────────
  private async analyzeWithGroq(message: string): Promise<AIAnalysis> {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a Web3 intent parser for Arc Testnet (chainId 5042002).
Output ONLY valid JSON. No markdown, no explanation.

Rules:
- Supported tokens: USDC, EURC, USDT, and other ERC-20 tokens
- Swap is supported via kit.swap() with a KIT_KEY — parse swap requests normally
- For swap: extract tokenIn, tokenOut, amounts[0] as amountIn, swapChain (default "Ethereum" for mainnet swaps)
- For bridge: extract toChain and fromChain
- For transfer: extract addresses and amounts
- addresses must be valid 0x hex strings
- amounts must be numbers

Output schema:
{
  "taskTypes": ["transfer"|"batch"|"bridge"|"swap"|"query"|"impossible"],
  "entities": {
    "addresses": [],
    "amounts": [],
    "tokens": [],
    "tokenIn": null,
    "tokenOut": null,
    "toChain": null,
    "fromChain": null,
    "swapChain": null
  },
  "isScheduled": false,
  "scheduleTrigger": null
}`,
        },
        { role: "user", content: message },
      ],
    });

    try {
      return JSON.parse(
        completion.choices[0]?.message?.content ?? "{}"
      ) as AIAnalysis;
    } catch {
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
    if (tokenInfo.address === "EURC_NOT_DEPLOYED") {
      return {
        success: false,
        message:
          "❌ EURC is not deployed on Arc Testnet yet. Set ARC_EURC_ADDRESS environment variable.",
      };
    }

    // Get the agent's Circle wallet
    const { circleAddress } = await getOrCreateAgentWallet(context.userAddress);

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

    const { circleAddress } = await getOrCreateAgentWallet(context.userAddress);

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
  // SWAP — kit.swap() with KIT_KEY
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

    if (!process.env.KIT_KEY) {
      return {
        success: false,
        message: "❌ KIT_KEY is not configured. Swap requires a Circle Kit Key from the Console.",
      };
    }

    const { circleAddress } = await getOrCreateAgentWallet(context.userAddress);

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
      gasSponsorPolicyId,
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
  // General query — Groq answers conversationally
  // ─────────────────────────────────────────────────────────────────────────
  private async handleQuery(message: string): Promise<TaskResult> {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `You are J14-75, a Web3 AI assistant powered by the Arc App Kit.
You execute real on-chain transactions: send USDC/EURC on Arc Testnet, bridge USDC cross-chain via CCTP, and swap tokens on mainnet chains using kit.swap().
Email-authenticated users get gas-sponsored transactions via Circle Gas Station.
Never hallucinate transaction data. Be concise and helpful.`,
        },
        { role: "user", content: message },
      ],
    });

    return {
      success: true,
      message:
        completion.choices[0]?.message?.content ??
        "I can send tokens, check balances, and bridge USDC on Arc Testnet. What would you like to do?",
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Balance validation (checks the agent's Circle wallet on-chain)
  // ─────────────────────────────────────────────────────────────────────────
  private async assertBalance(
    address: string,
    token: string,
    requiredAmount: number
  ): Promise<void> {
    const tokenInfo = KNOWN_TOKENS[token];
    if (!tokenInfo) return;

    let balance: bigint;

    try {
      if (tokenInfo.address === "native") {
        balance = await arcClient.getBalance({ address: address as Address });
      } else if (tokenInfo.address !== "EURC_NOT_DEPLOYED") {
        balance = (await arcClient.readContract({
          address: tokenInfo.address as Address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address as Address],
        })) as bigint;
      } else {
        return; // Can't validate — skip
      }

      const required = parseUnits(requiredAmount.toString(), tokenInfo.decimals);
      const have = parseFloat(formatUnits(balance, tokenInfo.decimals));

      if (balance < required) {
        throw new Error(
          `Insufficient ${token} in agent wallet. Have ${have.toFixed(4)}, need ${requiredAmount}.\n` +
            `Fund the agent wallet at: ${address}`
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
