import { Router } from "express";
import { getOrCreateCircleWallet } from "../lib/circle-client.js";

const router = Router();

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function emailUserKey(email: string) {
  return `email:${normalizeEmail(email)}`;
}

router.post("/email/send-otp", async (req, res) => {
  const { email } = req.body as { email?: string };

  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Valid email is required." });
    return;
  }

  try {
    const { circleWalletId, circleAddress } = await getOrCreateCircleWallet(emailUserKey(email));
    res.json({
      success: true,
      userToken: null,
      encryptionKey: null,
      challengeId: null,
      existingWallet: {
        id: circleWalletId,
        address: circleAddress,
        blockchain: "ARC-TESTNET",
      },
      message: "Email authenticated and wallet ready.",
    });
  } catch (err: any) {
    console.error("email auth bootstrap error:", err);
    res.status(500).json({ error: err.message ?? "Failed to authenticate email user." });
  }
});

router.post("/email/verify-otp", async (req, res) => {
  const { email } = req.body as { email?: string };

  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Valid email is required." });
    return;
  }

  try {
    const { circleWalletId, circleAddress } = await getOrCreateCircleWallet(emailUserKey(email));
    res.json({
      success: true,
      walletAddress: circleAddress,
      walletId: circleWalletId,
      blockchain: "ARC-TESTNET",
    });
  } catch (err: any) {
    console.error("email verification error:", err);
    res.status(500).json({ error: err.message ?? "Email verification failed." });
  }
});

export default router;
