import { randomBytes } from "crypto";
import { registerEntitySecretCiphertext } from "@circle-fin/developer-controlled-wallets";
import { writeFileSync } from "fs";

async function main() {
  // Generate a cryptographically secure 32-byte entity secret
  const entitySecret = randomBytes(32).toString("hex");

  console.log("--------------------------------------------------");
  console.log("GENERATED ENTITY SECRET");
  console.log("Copy this value and add it to Replit Secrets as CIRCLE_ENTITY_SECRET:");
  console.log("");
  console.log(entitySecret);
  console.log("");
  console.log("--------------------------------------------------");

  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    console.error("ERROR: CIRCLE_API_KEY is not set. Add it to Replit Secrets and try again.");
    process.exit(1);
  }

  try {
    console.log("Registering entity secret with Circle...");

    // Do not pass recoveryFileDownloadPath — we write the file manually below
    const response = await registerEntitySecretCiphertext({
      apiKey,
      entitySecret,
    } as any);

    const recoveryContent: string = (response as any)?.data?.recoveryFile ?? "";
    if (recoveryContent) {
      const recoveryFilePath = "./recovery.dat";
      writeFileSync(recoveryFilePath, recoveryContent, "utf-8");
      console.log("Recovery file saved to: " + recoveryFilePath);
    } else {
      console.log("Note: No recovery file returned in the response.");
    }

    console.log("Entity secret registered successfully.");
    console.log("");
    console.log("--------------------------------------------------");
    console.log("NEXT STEP: Add the following to Replit Secrets:");
    console.log("  Key:   CIRCLE_ENTITY_SECRET");
    console.log("  Value: " + entitySecret);
    console.log("--------------------------------------------------");
  } catch (err: any) {
    console.error("Failed to register entity secret:");
    console.error(err?.message ?? err);
    process.exit(1);
  }
}

main();
