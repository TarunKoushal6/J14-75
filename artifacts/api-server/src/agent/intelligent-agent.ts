/**
 * J14-75 Intelligent Agent
 *
 * Flow:
 *   1. Groq (llama-3.3-70b-versatile) → parses intent → JSON
 *   2. Execution planner → maps intent to steps
 *   3. Circle SDK → signs each raw EVM transaction (keys managed server-side)
 *   4. Viem → broadcasts signed tx to Arc Testnet
 *   5. Viem → waits for on-chain confirmation
 *   6. Returns real txHash (no hallucinations, no mocking)
 *
 * Blockchain data:  ArcscanAPI (Blockscout) using BLOCKSCOUT_API_KEY env var
 * AI model:         Groq llama-3.3-70b-versatile
 * Chain:            Arc Testnet (chainId 5042002)
 */

import Groq from "groq-sdk";
import {
  parseUnits,
  formatUnits,
  Address,
  erc20Abi,
  encodeFunctionData,
  serializeTransaction,
} from "viem";
import { arcTestnet } from "viem/chains";
import {
  arcPublicClient,
  getOrCreateCircleWallet,
  getCircleClient,
  signAndBroadcastTransfer,
  signAndBroadcastApproval,
  fetchTokenBalances,
  fetchTransactionHistory,
} from "../lib/circle-client.js";

// ──────────────────────────────────────────────────────────────────────────────
// Groq client
// ──────────────────────────────────────────────────────────────────────────────
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ──────────────────────────────────────────────────────────────────────────────
// Known tokens on Arc Testnet
// ──────────────────────────────────────────────────────────────────────────────
const KNOWN_TOKENS: Record<
  string,
  { address: string; decimals: number; symbol: string }
> = {
  USDC: {
    address: "native",
    decimals: 18,
    symbol: "USDC",
  },
  EURC: {
    address: process.env.ARC_EURC_ADDRESS || "EURC_NOT_DEPLOYED",
    decimals: 6,
    symbol: "EURC",
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Scheduled task registry (in-memory)
// ──────────────────────────────────────────────────────────────────────────────
const scheduledTasks = new Map<
  string,
  {
    id: string;
    type: string;
    trigger: string;
    steps: any[];
    status: "active" | "completed" | "failed";
    createdAt: Date;
  }
>();

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────
export interface TaskContext {
  userAddress: string;
  message: string;
  chainId: number;
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
    queryAddresses?: string[];
    amounts?: number[];
    tokens?: string[];
    contractTypes?: string[];
    toChain?: string;
  };
  isScheduled: boolean;
  scheduleTrigger?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main agent class
// ──────────────────────────────────────────────────────────────────────────────
export class IntelligentAgent {
  // ────────────────────────────────────────────────────────────────────────────
  // Entry point
  // ────────────────────────────────────────────────────────────────────────────
  async processComplexTask(context: TaskContext): Promise<TaskResult> {
    try {
      console.log(`\n🤖 Agent processing: "${context.message}"`);

      // ── Fast-path: balance query ───────────────────────────────────────────
      const msgLower = context.message.toLowerCase();
      if (
        msgLower.includes("balance") ||
        msgLower.includes("how much") ||
        (msgLower.includes("token") && !msgLower.includes("transfer"))
      ) {
        console.log("💰 Fast-path: balance query → ArcscanAPI");
        const result = await fetchTokenBalances(context.userAddress);
        return { success: true, message: result };
      }

      // ── Fast-path: transaction history ────────────────────────────────────
      if (
        msgLower.includes("history") ||
        msgLower.includes("transaction") ||
        msgLower.includes("recent") ||
        msgLower.includes("past tx")
      ) {
        console.log("📜 Fast-path: history query → ArcscanAPI");
        const result = await fetchTransactionHistory(context.userAddress);
        return { success: true, message: result };
      }

      // ── Step 1: Groq AI analysis ──────────────────────────────────────────
      const analysis = await this.analyzeWithGroq(context.message);
      console.log("🔍 Groq analysis:", JSON.stringify(analysis, null, 2));

      // ── Step 2: Reject impossible tasks ───────────────────────────────────
      if (analysis.taskTypes.includes("impossible")) {
        return {
          success: false,
          message:
            "❌ This task is impossible with current Arc Testnet resources. Missing required contracts or tokens.",
        };
      }

      // ── Step 3: Handle scheduled tasks ────────────────────────────────────
      if (analysis.isScheduled && analysis.scheduleTrigger) {
        const taskId = `task_${Date.now()}`;
        scheduledTasks.set(taskId, {
          id: taskId,
          type: analysis.taskTypes[0] ?? "unknown",
          trigger: analysis.scheduleTrigger,
          steps: [],
          status: "active",
          createdAt: new Date(),
        });
        return {
          success: true,
          message: `⏰ Scheduled! ID: ${taskId}. Will execute when: ${analysis.scheduleTrigger}`,
          taskId,
          isScheduled: true,
        };
      }

      // ── Step 4: Route to executor ─────────────────────────────────────────
      return await this.executeTask(analysis, context);
    } catch (error: any) {
      console.error("❌ Agent error:", error);
      return {
        success: false,
        message: `🚨 ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Groq AI: parse intent → JSON
  // ────────────────────────────────────────────────────────────────────────────
  private async analyzeWithGroq(message: string): Promise<AIAnalysis> {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a Web3 AI intent parser for Arc Testnet (chainId 5042002).
Analyze the user message and return STRICT JSON — no markdown, no extra text.

CRITICAL RULES:
1. NEVER hallucinate txHashes, block numbers, or balances.
2. For impossible tasks (swap without DEX, unknown token), set taskTypes: ["impossible"].
3. Only USDC (native, 18 dec) and EURC (ERC-20) exist on Arc Testnet.
4. Addresses must start with 0x and be 42 characters.
5. amounts must be decimal numbers (not strings).

Output format (all fields required):
{
  "taskTypes": ["transfer" | "swap" | "bridge" | "approve" | "batch" | "query" | "impossible"],
  "entities": {
    "addresses": [],
    "queryAddresses": [],
    "amounts": [],
    "tokens": [],
    "contractTypes": [],
    "toChain": null
  },
  "isScheduled": false,
  "scheduleTrigger": null
}`,
        },
        { role: "user", content: message },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    try {
      return JSON.parse(raw) as AIAnalysis;
    } catch {
      console.error("Groq returned invalid JSON:", raw);
      return {
        taskTypes: ["query"],
        entities: {},
        isScheduled: false,
      };
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Task router
  // ────────────────────────────────────────────────────────────────────────────
  private async executeTask(
    analysis: AIAnalysis,
    context: TaskContext
  ): Promise<TaskResult> {
    const { taskTypes, entities } = analysis;

    // ── TRANSFER ──────────────────────────────────────────────────────────────
    if (taskTypes.includes("transfer")) {
      return await this.executeTransfer(entities, context);
    }

    // ── BATCH TRANSFER ────────────────────────────────────────────────────────
    if (taskTypes.includes("batch")) {
      return await this.executeBatch(entities, context);
    }

    // ── SWAP ──────────────────────────────────────────────────────────────────
    if (taskTypes.includes("swap")) {
      return await this.executeSwap(entities, context);
    }

    // ── BRIDGE ────────────────────────────────────────────────────────────────
    if (taskTypes.includes("bridge")) {
      return await this.executeBridge(entities, context);
    }

    // ── GENERAL QUERY (let Groq answer) ──────────────────────────────────────
    return await this.handleGeneralQuery(context.message);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // TRANSFER: single recipient
  // ────────────────────────────────────────────────────────────────────────────
  private async executeTransfer(
    entities: AIAnalysis["entities"],
    context: TaskContext
  ): Promise<TaskResult> {
    const recipient = entities.addresses?.[0];
    const amount = entities.amounts?.[0];
    const token = entities.tokens?.[0]?.toUpperCase() ?? "USDC";

    if (!recipient || !amount) {
      return {
        success: false,
        message: "❌ Transfer requires a recipient address and an amount.",
      };
    }

    const tokenInfo = KNOWN_TOKENS[token];
    if (!tokenInfo) {
      return {
        success: false,
        message: `❌ Unsupported token: ${token}. Only USDC and EURC are available on Arc Testnet.`,
      };
    }

    if (tokenInfo.address === "EURC_NOT_DEPLOYED") {
      return {
        success: false,
        message:
          "❌ EURC is not deployed yet. Set the ARC_EURC_ADDRESS environment variable.",
      };
    }

    const amountWei = parseUnits(amount.toString(), tokenInfo.decimals);

    // Validate balance
    const balance = await this.getOnChainBalance(context.userAddress, token);
    if (balance < amountWei) {
      return {
        success: false,
        message: `❌ Insufficient ${token}. You have ${formatUnits(balance, tokenInfo.decimals)}, need ${amount}.`,
      };
    }

    // Get / create Circle wallet
    const { circleWalletId, circleAddress } = await getOrCreateCircleWallet(
      context.userAddress
    );

    console.log(
      `💸 Transferring ${amount} ${token} → ${recipient} via Circle wallet ${circleWalletId} (${circleAddress})`
    );

    const txHash = await signAndBroadcastTransfer({
      circleWalletId,
      from: circleAddress as Address,
      to: recipient as Address,
      amountWei,
      isNative: tokenInfo.address === "native",
      tokenAddress:
        tokenInfo.address !== "native"
          ? (tokenInfo.address as Address)
          : undefined,
    });

    return {
      success: true,
      message: `✅ Transfer complete!\n• ${amount} ${token} → ${recipient}\n• TxHash: ${txHash}\n• Explorer: https://testnet.arcscan.app/tx/${txHash}`,
      txHash,
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // BATCH TRANSFER: multiple recipients
  // ────────────────────────────────────────────────────────────────────────────
  private async executeBatch(
    entities: AIAnalysis["entities"],
    context: TaskContext
  ): Promise<TaskResult> {
    const recipients = entities.addresses ?? [];
    const amounts = entities.amounts ?? [];
    const token = entities.tokens?.[0]?.toUpperCase() ?? "USDC";

    if (recipients.length === 0 || amounts.length === 0) {
      return {
        success: false,
        message: "❌ Batch transfer requires recipient addresses and amounts.",
      };
    }

    const tokenInfo = KNOWN_TOKENS[token];
    if (!tokenInfo || tokenInfo.address === "EURC_NOT_DEPLOYED") {
      return { success: false, message: `❌ Unsupported token: ${token}` };
    }

    const total = amounts.reduce((s, a) => s + a, 0);
    const balance = await this.getOnChainBalance(context.userAddress, token);
    const totalWei = parseUnits(total.toString(), tokenInfo.decimals);

    if (balance < totalWei) {
      return {
        success: false,
        message: `❌ Insufficient ${token}. Need ${total}, have ${formatUnits(balance, tokenInfo.decimals)}.`,
      };
    }

    const { circleWalletId, circleAddress } = await getOrCreateCircleWallet(
      context.userAddress
    );

    const txHashes: string[] = [];
    const logs: string[] = [];

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const amount = amounts[i] ?? amounts[0];
      const amountWei = parseUnits(amount.toString(), tokenInfo.decimals);

      console.log(`📦 Batch [${i + 1}/${recipients.length}] → ${recipient} (${amount} ${token})`);

      const txHash = await signAndBroadcastTransfer({
        circleWalletId,
        from: circleAddress as Address,
        to: recipient as Address,
        amountWei,
        isNative: tokenInfo.address === "native",
        tokenAddress:
          tokenInfo.address !== "native"
            ? (tokenInfo.address as Address)
            : undefined,
      });

      txHashes.push(txHash);
      logs.push(`  [${i + 1}] ${recipient.slice(0, 8)}... → ${amount} ${token} | ${txHash.slice(0, 14)}...`);
    }

    return {
      success: true,
      message: `✅ Batch complete! ${recipients.length} transfers executed:\n${logs.join("\n")}\n\nAll confirmed on Arc Testnet.`,
      txHash: txHashes[txHashes.length - 1],
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // SWAP: requires ARC_DEX_ADDRESS env var
  // ────────────────────────────────────────────────────────────────────────────
  private async executeSwap(
    entities: AIAnalysis["entities"],
    context: TaskContext
  ): Promise<TaskResult> {
    const dexAddress = process.env.ARC_DEX_ADDRESS;
    if (!dexAddress) {
      return {
        success: false,
        message:
          "❌ Swap unavailable: DEX address not configured. Set ARC_DEX_ADDRESS environment variable to the DEX contract address on Arc Testnet.",
      };
    }

    const fromToken = entities.tokens?.[0]?.toUpperCase() ?? "USDC";
    const toToken = entities.tokens?.[1]?.toUpperCase() ?? "EURC";
    const amount = entities.amounts?.[0];

    if (!amount) {
      return { success: false, message: "❌ Swap requires an amount." };
    }

    const fromInfo = KNOWN_TOKENS[fromToken];
    const toInfo = KNOWN_TOKENS[toToken];

    if (!fromInfo || !toInfo) {
      return {
        success: false,
        message: `❌ Unsupported token pair: ${fromToken}/${toToken}. Arc Testnet supports USDC and EURC.`,
      };
    }

    if (fromInfo.address === "EURC_NOT_DEPLOYED" || toInfo.address === "EURC_NOT_DEPLOYED") {
      return { success: false, message: "❌ EURC not deployed. Set ARC_EURC_ADDRESS." };
    }

    const amountWei = parseUnits(amount.toString(), fromInfo.decimals);
    const balance = await this.getOnChainBalance(context.userAddress, fromToken);

    if (balance < amountWei) {
      return {
        success: false,
        message: `❌ Insufficient ${fromToken}. Have ${formatUnits(balance, fromInfo.decimals)}, need ${amount}.`,
      };
    }

    const { circleWalletId, circleAddress } = await getOrCreateCircleWallet(
      context.userAddress
    );

    const txHashes: string[] = [];

    // Step 1: Approve DEX to spend token (only for ERC-20, not native)
    if (fromInfo.address !== "native") {
      console.log(`🔐 Approving DEX ${dexAddress} to spend ${amount} ${fromToken}...`);
      const approveTxHash = await signAndBroadcastApproval({
        circleWalletId,
        from: circleAddress as Address,
        tokenAddress: fromInfo.address as Address,
        spender: dexAddress as Address,
        amountWei,
      });
      txHashes.push(approveTxHash);
      console.log(`✅ Approval confirmed: ${approveTxHash}`);
    }

    // Step 2: Execute swap via DEX contract
    const swapData = encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "swap",
          stateMutability: "nonpayable",
          inputs: [
            { name: "amountIn", type: "uint256" },
            { name: "minAmountOut", type: "uint256" },
            { name: "tokenIn", type: "address" },
            { name: "tokenOut", type: "address" },
            { name: "to", type: "address" },
            { name: "deadline", type: "uint256" },
          ],
          outputs: [{ name: "amountOut", type: "uint256" }],
        },
      ] as any,
      functionName: "swap",
      args: [
        amountWei,
        0n,
        fromInfo.address === "native" ? "0x0000000000000000000000000000000000000000" : (fromInfo.address as Address),
        toInfo.address === "native" ? "0x0000000000000000000000000000000000000000" : (toInfo.address as Address),
        circleAddress as Address,
        BigInt(Math.floor(Date.now() / 1000) + 3600),
      ] as any,
    });

    const nonce = await arcPublicClient.getTransactionCount({
      address: circleAddress as Address,
    });
    const feeData = await arcPublicClient.estimateFeesPerGas().catch(() => ({
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    }));

    const client = getCircleClient();

    const unsignedSwapTx = {
      chainId: arcTestnet.id,
      nonce,
      type: "eip1559" as const,
      maxFeePerGas: feeData.maxFeePerGas ?? 1_000_000_000n,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 1_000_000_000n,
      gas: 300_000n,
      to: dexAddress as Address,
      value: fromInfo.address === "native" ? amountWei : 0n,
      data: swapData,
    };

    const serialized = serializeTransaction(unsignedSwapTx);
    const signRes = await client.signTransaction({
      walletId: circleWalletId,
      rawTransaction: serialized,
      memo: `Swap ${amount} ${fromToken} for ${toToken}`,
    });

    const signedTxHex = signRes.data?.signedTransaction;
    if (!signedTxHex) throw new Error("Circle did not return signed swap tx.");

    const swapTxHash = await arcPublicClient.sendRawTransaction({
      serializedTransaction: signedTxHex as `0x${string}`,
    });

    const receipt = await arcPublicClient.waitForTransactionReceipt({
      hash: swapTxHash,
      timeout: 90_000,
    });

    if (receipt.status !== "success") {
      throw new Error(`Swap reverted on Arc Testnet. txHash: ${swapTxHash}`);
    }

    txHashes.push(swapTxHash);

    return {
      success: true,
      message: `✅ Swap complete!\n• ${amount} ${fromToken} → ${toToken}\n• TxHash: ${swapTxHash}\n• Explorer: https://testnet.arcscan.app/tx/${swapTxHash}`,
      txHash: swapTxHash,
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // BRIDGE: CCTP not fully deployed on Arc Testnet — explain clearly
  // ────────────────────────────────────────────────────────────────────────────
  private async executeBridge(
    entities: AIAnalysis["entities"],
    context: TaskContext
  ): Promise<TaskResult> {
    const token = entities.tokens?.[0]?.toUpperCase() ?? "USDC";
    const toChain = entities.toChain ?? "unknown";
    const amount = entities.amounts?.[0];

    if (token !== "USDC") {
      return {
        success: false,
        message: `❌ Only USDC can be bridged (via CCTP). ${token} bridging is not supported.`,
      };
    }

    if (!process.env.CCTP_TOKEN_MESSENGER_ADDRESS) {
      return {
        success: false,
        message: `⚠️ Bridge plan created but cannot execute: CCTP TokenMessenger contract address is required.\n\n• Amount: ${amount} USDC\n• From: Arc Testnet\n• To: ${toChain}\n\nSet CCTP_TOKEN_MESSENGER_ADDRESS environment variable to enable live bridging.`,
      };
    }

    return {
      success: false,
      message: "❌ CCTP bridge integration requires additional contract deployment on Arc Testnet.",
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // General query: pass back to Groq for a plain answer
  // ────────────────────────────────────────────────────────────────────────────
  private async handleGeneralQuery(message: string): Promise<TaskResult> {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `You are J14-75, a Web3 AI assistant running on Arc Testnet (chainId 5042002).
You help users with DeFi tasks: transfer, swap, bridge, check balances, transaction history.
Supported tokens: USDC (native, 18 dec), EURC (ERC-20).
Never invent transaction hashes, balances, or block numbers.
Keep responses concise and helpful.`,
        },
        { role: "user", content: message },
      ],
    });

    return {
      success: true,
      message:
        completion.choices[0]?.message?.content ??
        "I can help you transfer tokens, check balances, view transaction history, swap tokens, and bridge USDC on Arc Testnet.",
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Real on-chain balance via viem (used for validation before tx)
  // ────────────────────────────────────────────────────────────────────────────
  private async getOnChainBalance(
    userAddress: string,
    token: string
  ): Promise<bigint> {
    const tokenInfo = KNOWN_TOKENS[token];
    if (!tokenInfo)
      throw new Error(
        `Token ${token} not supported. Only USDC and EURC are on Arc Testnet.`
      );

    if (tokenInfo.address === "native") {
      return arcPublicClient.getBalance({ address: userAddress as Address });
    }

    if (tokenInfo.address === "EURC_NOT_DEPLOYED") {
      throw new Error("EURC not deployed — set ARC_EURC_ADDRESS.");
    }

    const balance = await arcPublicClient.readContract({
      address: tokenInfo.address as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [userAddress as Address],
    });

    return balance as bigint;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Scheduled task accessors
  // ────────────────────────────────────────────────────────────────────────────
  public getScheduledTask(taskId: string) {
    return scheduledTasks.get(taskId);
  }

  public getScheduledTasks() {
    return Array.from(scheduledTasks.values());
  }
}

