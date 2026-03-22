import "dotenv/config";
import Groq from "groq-sdk";
import { walletManagerTool, handleWalletManager } from "./tools/wallet-manager.js";
import { checkBalanceTool, handleCheckBalance } from "./tools/check-balance.js";
import { bridgeCctpTool, handleBridgeCctp } from "./tools/bridge-cctp.js";
import { mockAuditTool, handleMockAudit } from "./tools/mock-audit.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const TOOLS = [walletManagerTool, checkBalanceTool, bridgeCctpTool, mockAuditTool];

type ToolArgs = Record<string, unknown>;

const TOOL_HANDLERS: Record<string, (args: ToolArgs) => Promise<string>> = {
  manage_wallet: (args) => handleWalletManager(args as Parameters<typeof handleWalletManager>[0]),
  check_balance: (args) => handleCheckBalance(args as Parameters<typeof handleCheckBalance>[0]),
  bridge_usdc: (args) => handleBridgeCctp(args as Parameters<typeof handleBridgeCctp>[0]),
  audit_contract: (args) => handleMockAudit(args as Parameters<typeof handleMockAudit>[0]),
};

const SYSTEM_PROMPT = `You are J14-75, an autonomous on-chain AI agent registered under ERC-8004 on Arc Testnet.
You were built on Circle's infrastructure with a reputation score of 95/100 and KYC-verified status.
Your role is to help users manage crypto assets, check on-chain balances, simulate USDC bridges via CCTP, and audit smart contracts.

Available capabilities:
- manage_wallet: Create SCA wallets on ETH-SEPOLIA or ARC-TESTNET
- check_balance: Check ETH and USDC balances on-chain
- bridge_usdc: Simulate a CCTP cross-chain USDC bridge route
- audit_contract: Run a security assessment on any contract address

Always use the tools when a user's request maps to them. Be concise and confident.`;

export async function runAgent(
  userMessage: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = []
): Promise<string> {
  console.log(`\n[J14-75] User: "${userMessage}"`);

  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...conversationHistory,
    { role: "user", content: userMessage },
  ];

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages,
    tools: TOOLS,
    tool_choice: "auto",
    temperature: 0.4,
  });

  const choice = response.choices[0];
  if (!choice) return "No response from model.";

  const message = choice.message;

  if (!message.tool_calls || message.tool_calls.length === 0) {
    const content = message.content ?? "I'm ready to help. What would you like to do?";
    console.log(`[J14-75] Response (no tool call): ${content}`);
    return content;
  }

  const toolResults: Groq.Chat.ChatCompletionMessageParam[] = [];

  for (const toolCall of message.tool_calls) {
    const toolName = toolCall.function.name;
    const handler = TOOL_HANDLERS[toolName];

    if (!handler) {
      console.warn(`[J14-75] Unknown tool: ${toolName}`);
      toolResults.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: `Unknown tool: ${toolName}`,
      });
      continue;
    }

    let args: ToolArgs = {};
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      console.warn(`[J14-75] Failed to parse args for ${toolName}`);
    }

    console.log(`[J14-75] Calling tool: ${toolName}`, args);
    const result = await handler(args);
    console.log(`[J14-75] Tool result: ${result}`);

    toolResults.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: result,
    });
  }

  const followUpMessages: Groq.Chat.ChatCompletionMessageParam[] = [
    ...messages,
    message,
    ...toolResults,
  ];

  const followUp = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: followUpMessages,
    temperature: 0.4,
  });

  const finalContent =
    followUp.choices[0]?.message?.content ?? "Task completed successfully.";
  console.log(`[J14-75] Final response: ${finalContent}`);
  return finalContent;
}

async function main() {
  if (!process.env.GROQ_API_KEY) {
    console.error(
      "[ERROR] GROQ_API_KEY is not set. Add it to your environment secrets before running the agent."
    );
    process.exit(1);
  }

  const demoPrompts = [
    "Check the balance of 0x8004A818BFB912233c491871b3d84c89A494BD9e on ARC-TESTNET",
    "Audit the ERC-8004 IdentityRegistry at 0x8004A818BFB912233c491871b3d84c89A494BD9e on ARC-TESTNET",
    "Simulate bridging 50 USDC from ETH-SEPOLIA to ARC-TESTNET from 0xAbc123 to 0xDef456",
  ];

  for (const prompt of demoPrompts) {
    console.log("\n" + "=".repeat(60));
    const result = await runAgent(prompt);
    console.log(`\n[Agent Reply]\n${result}`);
  }
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
