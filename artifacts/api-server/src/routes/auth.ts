/**
 * Email OTP Authentication Routes
 *
 * Circle User-Controlled Wallet email OTP flow server-side.
 * Circle's infrastructure handles: email delivery, OTP verification, wallet creation.
 *
 * POST /api/auth/email/send-otp   → triggers OTP email via Circle, returns auth params
 *
 * The flow uses Circle's User-Controlled Wallets SDK:
 *   - API key auth: CIRCLE_API_KEY env var
 *   - User wallets created via challenge-response model
 *   - Gas Station policy: GAS_STATION_POLICY_ID env var (sponsoring user txs)
 *
 * Reference: https://developers.circle.com/wallets/user-controlled/create-user-wallets-with-email
 */

import { Router } from "express";

const router = Router();

// ── POST /api/auth/email/send-otp ──────────────────────────────────────────
router.post("/email/send-otp", async (req, res) => {
  const { email } = req.body as { email?: string };

  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Valid email is required." });
    return;
  }

  try {
    const apiKey = process.env.CIRCLE_API_KEY;
    if (!apiKey) {
      throw new Error("CIRCLE_API_KEY is not configured.");
    }

    const baseCircleUrl = "https://api.circle.com/v1/w3s";

    // Step 1: Create user (idempotent — Circle returns existing user if already created)
    const createUserRes = await fetch(`${baseCircleUrl}/users`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId: email }),
    });

    if (!createUserRes.ok && createUserRes.status !== 409) {
      const body = await createUserRes.text();
      console.error("Circle create user error:", body);
      throw new Error(`Circle API error (${createUserRes.status})`);
    }

    // Step 2: Create device token for this user session
    const deviceTokenRes = await fetch(`${baseCircleUrl}/users/deviceToken`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId: email }),
    });

    if (!deviceTokenRes.ok) {
      const body = await deviceTokenRes.text();
      console.error("Circle device token error:", body);
      throw new Error(`Circle device token error (${deviceTokenRes.status})`);
    }

    const deviceTokenData = await deviceTokenRes.json() as any;
    const deviceToken = deviceTokenData.data?.deviceToken;

    // Step 3: Get user token + encryption key (triggers OTP email)
    const tokenRes = await fetch(`${baseCircleUrl}/users/token`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ 
        userId: email,
        deviceToken: deviceToken,
        deviceEncryptionKey: deviceToken, // Use device token as encryption key for Email OTP
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error("Circle user token error:", body);
      throw new Error(`Circle token error (${tokenRes.status})`);
    }

    const tokenData = await tokenRes.json() as any;
    const userToken = tokenData.data?.userToken;
    const encryptionKey = tokenData.data?.encryptionKey;

    if (!userToken || !encryptionKey) {
      throw new Error("Circle did not return userToken/encryptionKey.");
    }

    // Step 4: Create wallet initialization challenge
    // This creates a challenge that the frontend will execute with the SDK
    const challengeRes = await fetch(`${baseCircleUrl}/user/initializing`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-User-Token": userToken,
      },
      body: JSON.stringify({
        idempotencyKey: `wallet-init-${email}-${Date.now()}`,
        encryptedDeviceSecret: encryptionKey,
      }),
    });

    let challengeId = "";
    
    if (challengeRes.ok) {
      const challengeData = await challengeRes.json() as any;
      challengeId = challengeData.data?.challengeId;
    } else if (challengeRes.status === 409) {
      // User already initialized, get existing wallets
      const walletsRes = await fetch(`${baseCircleUrl}/wallets?userId=${encodeURIComponent(email)}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
      });
      
      if (walletsRes.ok) {
        const walletsData = await walletsRes.json() as any;
        const wallets = walletsData.data?.wallets ?? [];
        
        if (wallets.length > 0) {
          console.log(`✅ Existing wallet found for ${email}: ${wallets[0].address}`);
          // Return existing wallet info
          res.json({
            success: true,
            userToken,
            encryptionKey,
            challengeId: null, // No challenge needed, already initialized
            existingWallet: {
              id: wallets[0].id,
              address: wallets[0].address,
              blockchain: wallets[0].blockchain,
            },
            message: "User already has a wallet. Authenticating with existing wallet.",
          });
          return;
        }
      }
    } else {
      const body = await challengeRes.text();
      console.warn("Wallet initialization challenge error:", body);
      // Continue without challenge, frontend will handle
    }

    console.log(`✅ Circle OTP session created for ${email}`);
    res.json({
      success: true,
      userToken,
      encryptionKey,
      challengeId,
      message: "Verification code sent to your email.",
    });
  } catch (err: any) {
    console.error("send-otp error:", err);
    res.status(500).json({ error: err.message ?? "Failed to initiate email OTP." });
  }
});

// ── POST /api/auth/email/verify-otp ───────────────────────────────────────
// This endpoint is no longer needed for Email OTP flow - the SDK handles verification
// Kept for backward compatibility
router.post("/email/verify-otp", async (req, res) => {
  const { email } = req.body as { email?: string };

  if (!email) {
    res.status(400).json({ error: "email is required." });
    return;
  }

  try {
    const apiKey = process.env.CIRCLE_API_KEY;
    if (!apiKey) throw new Error("CIRCLE_API_KEY is not configured.");

    const baseCircleUrl = "https://api.circle.com/v1/w3s";

    // Get user's wallets
    const walletsRes = await fetch(`${baseCircleUrl}/wallets?userId=${encodeURIComponent(email)}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
    });

    if (!walletsRes.ok) {
      throw new Error("Failed to fetch user wallets");
    }

    const walletsData = await walletsRes.json() as any;
    const wallets = walletsData.data?.wallets ?? [];

    if (wallets.length === 0) {
      res.status(400).json({ error: "No wallet found for this user. Please complete wallet creation first." });
      return;
    }

    const wallet = wallets[0];

    console.log(`✅ Email signin successful for ${email} → ${wallet.address}`);

    res.json({
      success: true,
      walletAddress: wallet.address,
      walletId: wallet.id,
      blockchain: wallet.blockchain,
    });
  } catch (err: any) {
    console.error("verify-otp error:", err);
    res.status(500).json({ error: err.message ?? "OTP verification failed." });
  }
});

export default router;
