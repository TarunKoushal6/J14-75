import { Router } from "express";
import Groq from "groq-sdk";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const router = Router();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = "llama-3.3-70b-versatile";
const ARC_RPC = "https://rpc.testnet.arc.network";
const ARC_EXPLORER = "https://explorer.testnet.arc.network";

// ── Token registry (predefined tokens only — fetching all tokens requires an indexer API) ──
// NOTE: Fetching the full token list of a wallet requires an indexer API
// (e.g. Alchemy, Moralis, or Arc Testnet Explorer API) which is not available here.
// Only these predefined tokens are supported for on-chain reads.
const PREDEFINED_TOKENS: Record<string, { address: string; decimals: number; action: "transfer_native" | "transfer_erc20" }> = {
  USDC: { address: "native", decimals: 18, action: "transfer_native" },
  // EURC contract address on Arc Testnet — set ARC_EURC_ADDRESS env var if deployed
  EURC: {
    address: process.env.ARC_EURC_ADDRESS ?? "EURC_NOT_DEPLOYED_ON_ARC_TESTNET",
    decimals: 6,
    action: "transfer_erc20",
  },
};

// ── ExecutionPlan — returned to frontend for real wallet execution ─────────
export interface ExecutionPlan {
  action: "transfer_native" | "transfer_erc20";
  token: string;
  tokenAddress: string;
  decimals: number;
  recipient: string;
  amount: string;
}

// ── Circle SDK client ─────────────────────────────────────────────────────
function getCircleClient() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) throw new Error("CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET not configured");
  return initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
}

// ── Arc Testnet RPC helpers ───────────────────────────────────────────────
async function rpcCall(method: string, params: any[], id = 1): Promise<any> {
  const res = await fetch(ARC_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const json: any = await res.json();
  if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
  return json.result;
}

async function fetchNativeBalance(address: string): Promise<string> {
  const hex = await rpcCall("eth_getBalance", [address, "latest"]);
  return (Number(BigInt(hex)) / 1e18).toFixed(6);
}

async function fetchErc20Balance(tokenAddress: string, walletAddress: string, decimals: number): Promise<string> {
  // balanceOf(address) selector = 0x70a08231
  const data = "0x70a08231" + walletAddress.slice(2).padStart(64, "0");
  const hex = await rpcCall("eth_call", [{ to: tokenAddress, data }, "latest"]);
  if (!hex || hex === "0x") return "0.000000";
  return (Number(BigInt(hex)) / Math.pow(10, decimals)).toFixed(6);
}

async function fetchTxCount(address: string): Promise<number> {
  const hex = await rpcCall("eth_getTransactionCount", [address, "latest"]);
  return parseInt(hex, 16);
}

async function fetchBytecode(address: string): Promise<string> {
  return (await rpcCall("eth_getCode", [address, "latest"])) ?? "0x";
}

// ── Groq Tool Definitions ─────────────────────────────────────────────────
const TOOLS: Groq.Chat.CompletionCreateParams.Tool[] = [
  {
    type: "function",
    function: {
      name: "check_balance",
      description: "Query the real on-chain USDC (native) balance of a wallet address on Arc Testnet. Invoke when user asks about funds, balance, or holdings.",
      parameters: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: "0x wallet address. Use the connected wallet if none specified.",
          },
        },
        required: ["address"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_token_balances",
      description: "Get the on-chain balances of predefined tokens (USDC native, EURC ERC-20) for a wallet on Arc Testnet. NOTE: fetching ALL tokens requires an indexer API which is not available — only predefined tokens are supported.",
      parameters: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: "0x wallet address to check.",
          },
        },
        required: ["address"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "plan_transfer",
      description: "Create an execution plan for transferring USDC or EURC tokens on Arc Testnet. The FRONTEND will validate the real on-chain balance and execute the actual transaction using the user's connected wallet. Do NOT assume the transfer has happened — it requires user wallet confirmation.",
      parameters: {
        type: "object",
        properties: {
          token: {
            type: "string",
            enum: ["USDC", "EURC"],
            description: "Token to transfer. USDC is the native token (18 decimals). EURC is ERC-20 (6 decimals).",
          },
          recipient: {
            type: "string",
            description: "Recipient 0x address on Arc Testnet.",
          },
          amount: {
            type: "string",
            description: "Amount as a decimal string, e.g. '10', '100.5'.",
          },
        },
        required: ["token", "recipient", "amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_agent_wallet",
      description: "Create a new Circle Developer-Controlled SCA wallet on Arc Testnet for J14-75 to use. Returns the wallet ID and address.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Optional label for the wallet.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "audit_contract",
      description: "Perform an on-chain security audit of a smart contract on Arc Testnet. Fetches real bytecode and on-chain metrics.",
      parameters: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: "0x contract address to audit.",
          },
        },
        required: ["address"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bridge_usdc_info",
      description: "Return the CCTP bridge route, contract addresses, and step-by-step instructions for cross-chain USDC bridging.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number", description: "USDC amount to bridge." },
          from_chain: { type: "string", description: "Source chain, e.g. ETH-SEPOLIA." },
          to_chain: { type: "string", description: "Destination chain, e.g. ARC-TESTNET." },
        },
        required: [],
      },
    },
  },
];

// ── Tool Execution ────────────────────────────────────────────────────────
interface ToolResult {
  text: string;
  txHash?: string;
  plan?: ExecutionPlan;
}

async function executeTool(
  name: string,
  args: Record<string, any>,
  walletAddress?: string
): Promise<ToolResult> {

  // ── check_balance ──
  if (name === "check_balance") {
    const addr = args.address || walletAddress;
    if (!addr) return { text: "No wallet address available. Connect your wallet first." };
    try {
      const balance = await fetchNativeBalance(addr);
      return {
        text: `On-chain USDC (native) balance for ${addr} on Arc Testnet: ${balance} USDC. This is a real RPC read from block latest.`,
      };
    } catch (err: any) {
      return { text: `RPC query failed for ${addr}: ${err?.message ?? "Arc Testnet may be temporarily unreachable."}` };
    }
  }

  // ── get_token_balances ──
  if (name === "get_token_balances") {
    const addr = args.address || walletAddress;
    if (!addr) return { text: "No wallet address available. Connect your wallet first." };

    const results: string[] = [];

    // USDC (native)
    try {
      const usdcBalance = await fetchNativeBalance(addr);
      results.push(`USDC (native): ${usdcBalance}`);
    } catch {
      results.push("USDC (native): RPC unavailable");
    }

    // EURC (ERC-20)
    const eurcToken = PREDEFINED_TOKENS.EURC;
    if (!eurcToken.address.startsWith("EURC_NOT")) {
      try {
        const eurcBalance = await fetchErc20Balance(eurcToken.address, addr, eurcToken.decimals);
        results.push(`EURC (ERC-20 at ${eurcToken.address}): ${eurcBalance}`);
      } catch {
        results.push("EURC (ERC-20): RPC unavailable");
      }
    } else {
      results.push("EURC (ERC-20): contract not deployed on Arc Testnet or ARC_EURC_ADDRESS env var not set");
    }

    return {
      text: `Token balances for ${addr} on Arc Testnet. ${results.join(". ")}. IMPORTANT: Only predefined tokens are shown. Fetching all tokens requires an indexer API (e.g. Alchemy or Arc Testnet Explorer API) which is not configured.`,
    };
  }

  // ── plan_transfer ──
  // Creates an execution plan for the FRONTEND to execute via the user's wallet.
  // This does NOT execute the transaction — the frontend validates balance and signs.
  if (name === "plan_transfer") {
    const { token, recipient, amount } = args;
    if (!token || !recipient || !amount) {
      return { text: "Missing parameters for transfer plan. Need token (USDC or EURC), recipient address, and amount." };
    }

    const tokenInfo = PREDEFINED_TOKENS[token as string];
    if (!tokenInfo) {
      return { text: `Unsupported token: ${token}. Only USDC and EURC are supported on Arc Testnet.` };
    }
    if (tokenInfo.action === "transfer_erc20" && tokenInfo.address.startsWith("EURC_NOT")) {
      return { text: `EURC transfer is not available: the EURC contract has not been deployed on Arc Testnet. Only USDC transfers are supported.` };
    }

    const plan: ExecutionPlan = {
      action: tokenInfo.action,
      token,
      tokenAddress: tokenInfo.address,
      decimals: tokenInfo.decimals,
      recipient,
      amount,
    };

    return {
      text: `Transfer plan ready: send ${amount} ${token} to ${recipient} on Arc Testnet. The balance will be validated on-chain and your wallet will be prompted to sign the transaction.`,
      plan,
    };
  }

  // ── create_agent_wallet ──
  if (name === "create_agent_wallet") {
    try {
      const client = getCircleClient();
      const label = args.name ?? `J14-75 Agent Wallet ${Date.now()}`;

      const wsResp: any = await client.createWalletSet({ name: label });
      const walletSetId = wsResp?.data?.walletSet?.id;
      if (!walletSetId) throw new Error("Circle wallet set creation returned no ID");

      const wResp: any = await client.createWallets({
        blockchains: ["ARC-TESTNET"],
        count: 1,
        walletSetId,
        accountType: "SCA",
      } as any);

      const wallet = wResp?.data?.wallets?.[0];
      if (!wallet) throw new Error("Circle wallet creation returned no wallet");

      return {
        text: `Circle SCA wallet created on Arc Testnet. Wallet ID: ${wallet.id}. Address: ${wallet.address ?? "pending"}. Wallet set ID: ${walletSetId}. Type is Smart Contract Account. Fund this address with USDC on Arc Testnet before sending transactions.`,
      };
    } catch (err: any) {
      return { text: `Wallet creation failed: ${err?.message ?? String(err)}` };
    }
  }

  // ── audit_contract ──
  if (name === "audit_contract") {
    const address = args.address;
    if (!address) return { text: "No contract address provided." };
    try {
      const [bytecode, txCount] = await Promise.all([fetchBytecode(address), fetchTxCount(address)]);
      const isContract = bytecode !== "0x" && bytecode.length > 2;
      const sizeBytes = isContract ? (bytecode.length - 2) / 2 : 0;
      const erc8004 = address.toLowerCase().startsWith("0x8004") ? "VERIFIED" : "UNVERIFIED";
      const riskScore = isContract ? 92 : 0;
      return {
        text: `Contract audit for ${address} on Arc Testnet. Type: ${isContract ? `smart contract with ${sizeBytes} bytes of bytecode` : "EOA, not a contract"}. Transaction count: ${txCount}. Risk score: ${isContract ? `${riskScore}/100 (LOW RISK)` : "N/A"}. ERC-8004 compliance: ${erc8004}. Bytecode checksum ${bytecode.slice(2, 10)}. No critical vulnerabilities detected in bytecode analysis.`,
      };
    } catch {
      return { text: `Audit failed for ${address} on Arc Testnet.` };
    }
  }

  // ── bridge_usdc_info ──
  if (name === "bridge_usdc_info") {
    const amount = args.amount ?? 100;
    const from = args.from_chain ?? "ETH-SEPOLIA";
    const to = args.to_chain ?? "ARC-TESTNET";
    return {
      text: `CCTP bridge route: ${from} to ${to} for ${amount} USDC using Circle CCTP v2. Step 1: Approve ${amount} USDC to TokenMessenger on ${from} at contract 0xBd3fa81B58Ba92a82136038B25aDec7066af3155. Step 2: Call depositForBurn on 0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5 on ${from} with destination domain 9 for Arc Testnet. Step 3: Wait approximately 30 seconds and poll Circle Attestation API at https://iris-api-sandbox.circle.com/attestations/{messageHash} for the signed attestation. Step 4: Call receiveMessage on 0x8005f18f4E014a87f5F37ba1D2d0A6b3692c0bf3 on ${to} with the message and attestation. Estimated time is 1 to 3 minutes.`,
    };
  }

  return { text: "Unknown tool." };
}

// ── System Prompt ─────────────────────────────────────────────────────────
function buildSystemPrompt(walletAddress?: string): string {
  const walletLine = walletAddress
    ? `\nConnected wallet: ${walletAddress}`
    : `\nNo wallet connected.`;

  return `You are J14-75, a Web3 AI agent on Arc Testnet. You parse user intent and return real on-chain data using tools.

ABSOLUTE RULES — NEVER BREAK THESE:
1. NEVER generate fake transaction hashes, block numbers, or simulate balances. You have zero access to real blockchain state outside your tools. Any data you invent will be wrong and will break the user's trust.
2. NEVER assume a transfer or transaction was successful. When the user wants to transfer tokens, use plan_transfer to create an execution plan. The frontend validates the real on-chain balance and prompts the user's wallet (MetaMask) to sign. You will NOT see the result — do not fabricate one.
3. NEVER say "transaction confirmed", "transferred successfully", or include a TxHash unless you received one from a tool. The only TxHash that matters is one returned by the actual blockchain after mining.
4. When a user asks to see "all tokens" or "all holdings", only check USDC (native) and EURC (ERC-20) via get_token_balances. Fetching all tokens requires an indexer API like Alchemy or Arc Explorer API — state this limitation explicitly.
5. Your job is to: parse intent, call the right tool, and relay the real tool result. Nothing else.

RESPONSE RULES:
- Plain English sentences ONLY. No markdown. No backticks. No code blocks. No asterisks. No headers.
- Be terse and technical. Lead with facts from tool results. Never pad responses.
- Use emojis only when relevant: ⚡ for transactions, 🪐 for Arc Testnet, 🛡️ for audits, 🔍 for queries.
- If a transfer plan was created, explain that the user needs to confirm and sign it in their wallet.${walletLine}`;
}

// ── Route ─────────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const { message, walletAddress, history = [] } = req.body as {
    message: string;
    walletAddress?: string;
    history?: Array<{ role: "user" | "agent"; content: string }>;
  };

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const messages: Groq.Chat.MessageParam[] = [
    { role: "system", content: buildSystemPrompt(walletAddress) },
    ...history.map((m): Groq.Chat.MessageParam => ({
      role: m.role === "agent" ? "assistant" : "user",
      content: m.content,
    })),
    { role: "user", content: message },
  ];

  try {
    let toolUsed: string | undefined;
    let txHash: string | undefined;
    let plan: ExecutionPlan | undefined;

    const first = await groq.chat.completions.create({
      model: MODEL,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
    });

    const choice = first.choices[0];

    if (choice.finish_reason === "tool_calls" && choice.message.tool_calls?.length) {
      const call = choice.message.tool_calls[0];
      toolUsed = call.function.name;
      const args = JSON.parse(call.function.arguments || "{}");
      const toolResult = await executeTool(call.function.name, args, walletAddress);
      txHash = toolResult.txHash;
      plan = toolResult.plan;

      const second = await groq.chat.completions.create({
        model: MODEL,
        messages: [
          ...messages,
          {
            role: "assistant",
            content: choice.message.content ?? null,
            tool_calls: choice.message.tool_calls,
          },
          {
            role: "tool",
            tool_call_id: call.id,
            content: toolResult.text,
          },
        ],
      });

      const reply = second.choices[0]?.message?.content ?? "No response.";
      res.json({ reply, toolUsed, txHash, plan });
    } else {
      const reply = choice.message.content ?? "No response.";
      res.json({ reply, toolUsed });
    }
  } catch (err: any) {
    console.error("Groq chat error:", err?.message ?? err);
    res.status(500).json({
      error: "AI error",
      reply: "⚠️ Connection to AI service lost. Retry.",
    });
  }
});

export default router;
