import {
  generateEntitySecret,
  registerEntitySecretCiphertext,
} from "@circle-fin/developer-controlled-wallets";

async function main() {
  const entitySecret = generateEntitySecret();

  console.log("--------------------------------------------------");
  console.log("GENERATED ENTITY SECRET (copy this value into Replit Secrets as CIRCLE_ENTITY_SECRET):");
  console.log(entitySecret);
  console.log("--------------------------------------------------");

  try {
    const response = await registerEntitySecretCiphertext({
      apiKey: process.env.CIRCLE_API_KEY,
      entitySecret: entitySecret,
      recoveryFileDownloadPath: "./recovery.dat",
    });
    console.log("Entity secret registered successfully.");
    console.log("Recovery file saved to: ./recovery.dat");
    console.log("Registration response:", JSON.stringify(response, null, 2));
  } catch (err) {
    console.error("Failed to register entity secret:");
    console.error(err);
  }
}

main();
