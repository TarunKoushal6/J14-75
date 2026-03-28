import { Router } from "express";
import { IntelligentAgent } from "../agent/intelligent-agent";

const router = Router();

// Initialize the intelligent agent
const agent = new IntelligentAgent();

// ── Route ─────────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const { message, walletAddress, isEmailUser = false, history = [] } = req.body as {
    message: string;
    walletAddress?: string;
    isEmailUser?: boolean;
    history?: Array<{ role: "user" | "agent"; content: string }>;
  };

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message is required" });
    return;
  }

  if (!walletAddress) {
    res.status(400).json({ error: "walletAddress is required for execution" });
    return;
  }

  try {
    console.log(`\n🔄 Processing message from ${walletAddress}: "${message}"`);

    // Use the intelligent agent to process the task
    const result = await agent.processComplexTask({
      userAddress: walletAddress,
      message,
      chainId: 5042002, // Arc Testnet
      isEmailUser, // enables Gas Station sponsorship for email-authenticated users
    });

    // Log the result
    console.log("✅ Agent result:", result);

    // Return the result to the frontend (don't include raw plan data with BigInt)
    res.json({
      reply: result.message,
      success: result.success,
      txHash: result.txHash,
      taskId: result.taskId,
      isScheduled: result.isScheduled,
    });
  } catch (err: any) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Agent error:", errorMsg);
    
    // Determine status code based on error type
    let statusCode = 500;
    if (errorMsg.includes("rate_limit")) statusCode = 429;
    if (errorMsg.includes("not found") || errorMsg.includes("Unsupported")) statusCode = 400;
    
    res.status(statusCode).json({
      error: errorMsg,
      reply: `⚠️ ${errorMsg}`,
      success: false,
    });
  }
});

export default router;
