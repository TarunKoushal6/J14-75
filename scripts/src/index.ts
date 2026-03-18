import "dotenv/config";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import {
  createPublicClient,
  http,
  parseAbiItem,
  keccak256,
  toHex,
  getContract,
  type Address,
} from "viem";
import { arcTestnet } from "viem/chains";

// ============================================================
// Contract addresses on Arc Testnet
// ============================================================
const IDENTITY_REGISTRY =
  "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
const REPUTATION_REGISTRY =
  "0x8004B663056A597Dffe9eCcC1965A193B7388713" as const;
const VALIDATION_REGISTRY =
  "0x8004Cb1BF31DAf7788923b405b754f57acEB4272" as const;

// ============================================================
// Minimal ABIs needed for viem reads
// ============================================================
const IDENTITY_REGISTRY_ABI = [
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "tokenURI",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

const VALIDATION_REGISTRY_ABI = [
  {
    name: "getValidationStatus",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestHash", type: "bytes32" }],
    outputs: [
      { name: "score", type: "uint8" },
      { name: "passed", type: "bool" },
      { name: "notes", type: "string" },
    ],
  },
] as const;

// ============================================================
// Helper: sleep
// ============================================================
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// ============================================================
// Helper: poll a Circle transaction until it reaches a terminal state
//
// The Circle SDK wraps responses so the transaction is under .data.transaction
// ============================================================
async function pollTransaction(
  circleClient: ReturnType<typeof initiateDeveloperControlledWalletsClient>,
  txId: string,
  label: string,
  maxAttempts = 30,
  intervalMs = 5000
): Promise<void> {
  console.log(
    `\n[Poll] Waiting for "${label}" (txId: ${txId}) to complete...`
  );

  const terminalStates = new Set([
    "COMPLETE",
    "FAILED",
    "CANCELLED",
    "DENIED",
  ]);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await circleClient.getTransaction({ id: txId });
    // The SDK returns TrimDataResponse wrapping TransactionResponse
    // which has data.transaction.state
    const state = (response as any)?.data?.transaction?.state as
      | string
      | undefined;

    console.log(`  Attempt ${attempt}/${maxAttempts}: state = ${state}`);

    if (state === "COMPLETE") {
      console.log(`  [OK] "${label}" completed successfully.`);
      return;
    }

    if (state && terminalStates.has(state)) {
      throw new Error(
        `Transaction "${label}" ended with unexpected state: ${state}`
      );
    }

    if (attempt < maxAttempts) {
      await sleep(intervalMs);
    }
  }

  throw new Error(
    `Transaction "${label}" did not complete after ${maxAttempts} attempts.`
  );
}

// ============================================================
// Main script
// ============================================================
async function main() {
  // ----------------------------------------------------------
  // Validate env vars
  // ----------------------------------------------------------
  const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;
  const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET;
  const METADATA_URI =
    process.env.METADATA_URI ||
    "ipfs://bafkreibdi6623n3xpf7ymk62ckb4bo75o3qemwkpfvp5i25j66itxvsoei";

  if (!CIRCLE_API_KEY || !CIRCLE_ENTITY_SECRET) {
    throw new Error(
      "Missing required environment variables: CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET must be set."
    );
  }

  // ----------------------------------------------------------
  // Step 2: Instantiate Circle client & create wallets
  // ----------------------------------------------------------
  console.log("\n=== STEP 2: Creating Circle Wallets ===");

  const circleClient = initiateDeveloperControlledWalletsClient({
    apiKey: CIRCLE_API_KEY,
    entitySecret: CIRCLE_ENTITY_SECRET,
  });

  const walletSetResponse = await circleClient.createWalletSet({
    name: "ERC8004 Agent Wallets",
  });
  const walletSetId = (walletSetResponse as any)?.data?.walletSet?.id as
    | string
    | undefined;
  if (!walletSetId) {
    throw new Error("Failed to create wallet set — no ID returned.");
  }
  console.log(`Wallet Set created: ${walletSetId}`);

  // ARC-TESTNET is not yet in the SDK's Blockchain enum (added after v7.3.0),
  // but the API accepts it — cast via `any` to bypass the type restriction.
  const walletsResponse = await circleClient.createWallets({
    blockchains: ["ARC-TESTNET"] as any,
    count: 2,
    walletSetId,
    accountType: "SCA",
  });

  const wallets = (walletsResponse as any)?.data?.wallets as
    | Array<{ id: string; address?: string }>
    | undefined;
  if (!wallets || wallets.length < 2) {
    throw new Error("Failed to create two wallets.");
  }

  const ownerWallet = wallets[0]!;
  const validatorWallet = wallets[1]!;

  if (!ownerWallet.address || !validatorWallet.address) {
    throw new Error("One or both wallet addresses are missing.");
  }

  console.log(`Owner Wallet ID:          ${ownerWallet.id}`);
  console.log(`Owner Wallet address:     ${ownerWallet.address}`);
  console.log(`Validator Wallet ID:      ${validatorWallet.id}`);
  console.log(`Validator Wallet address: ${validatorWallet.address}`);

  // ----------------------------------------------------------
  // Step 4: Register the Agent identity on IdentityRegistry
  // ----------------------------------------------------------
  console.log("\n=== STEP 4: Registering Agent Identity ===");

  const registerTxResponse =
    await circleClient.createContractExecutionTransaction({
      walletId: ownerWallet.id,
      contractAddress: IDENTITY_REGISTRY,
      abiFunctionSignature: "register(string)",
      abiParameters: [METADATA_URI],
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });

  const registerTxId = (registerTxResponse as any)?.data?.id as
    | string
    | undefined;
  if (!registerTxId) {
    throw new Error(
      "Failed to submit register() transaction — no ID returned."
    );
  }
  console.log(`Identity registration tx submitted: ${registerTxId}`);

  await pollTransaction(circleClient, registerTxId, "register(string)");

  // ----------------------------------------------------------
  // Step 5: Retrieve the minted Agent ID via Transfer event logs
  // ----------------------------------------------------------
  console.log("\n=== STEP 5: Retrieving Agent ID from Transfer logs ===");

  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(),
  });

  const latestBlock = await publicClient.getBlockNumber();

  const transferLogs = await publicClient.getLogs({
    address: IDENTITY_REGISTRY,
    event: parseAbiItem(
      "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
    ),
    args: { to: ownerWallet.address as Address },
    fromBlock: latestBlock - 10000n,
    toBlock: latestBlock,
  });

  if (transferLogs.length === 0) {
    throw new Error(
      "No Transfer logs found for the owner wallet. The registration may not have minted a token."
    );
  }

  const lastTransfer = transferLogs[transferLogs.length - 1]!;
  const agentId = lastTransfer.args.tokenId!.toString();
  console.log(`Agent ID (tokenId): ${agentId}`);

  // Fetch on-chain owner and tokenURI
  const identityContract = getContract({
    address: IDENTITY_REGISTRY,
    abi: IDENTITY_REGISTRY_ABI,
    client: publicClient,
  });

  const onChainOwner = await identityContract.read.ownerOf([BigInt(agentId)]);
  const tokenURIValue = await identityContract.read.tokenURI([BigInt(agentId)]);

  console.log(`On-chain owner:   ${onChainOwner}`);
  console.log(`Token URI:        ${tokenURIValue}`);

  // ----------------------------------------------------------
  // Step 6: Record reputation score via ReputationRegistry
  // ----------------------------------------------------------
  console.log("\n=== STEP 6: Recording Reputation Score ===");

  const tag = "successful_trade";
  const feedbackHash = keccak256(toHex(tag));

  const reputationTxResponse =
    await circleClient.createContractExecutionTransaction({
      walletId: validatorWallet.id,
      contractAddress: REPUTATION_REGISTRY,
      abiFunctionSignature:
        "giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)",
      abiParameters: [agentId, "95", "0", tag, "", "", "", feedbackHash],
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });

  const reputationTxId = (reputationTxResponse as any)?.data?.id as
    | string
    | undefined;
  if (!reputationTxId) {
    throw new Error(
      "Failed to submit giveFeedback() transaction — no ID returned."
    );
  }
  console.log(`Reputation feedback tx submitted: ${reputationTxId}`);

  await pollTransaction(
    circleClient,
    reputationTxId,
    "giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)"
  );

  // ----------------------------------------------------------
  // Step 7a: Validation Request (Owner → Validator)
  // ----------------------------------------------------------
  console.log("\n=== STEP 7a: Submitting Validation Request ===");

  const requestURI = "ipfs://bafkreiexamplevalidationrequest";
  const requestHash = keccak256(
    toHex(`kyc_verification_request_agent_${agentId}`)
  );

  const validationReqTxResponse =
    await circleClient.createContractExecutionTransaction({
      walletId: ownerWallet.id,
      contractAddress: VALIDATION_REGISTRY,
      abiFunctionSignature:
        "validationRequest(address,uint256,string,bytes32)",
      abiParameters: [
        validatorWallet.address,
        agentId,
        requestURI,
        requestHash,
      ],
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });

  const validationReqTxId = (validationReqTxResponse as any)?.data?.id as
    | string
    | undefined;
  if (!validationReqTxId) {
    throw new Error(
      "Failed to submit validationRequest() transaction — no ID returned."
    );
  }
  console.log(`Validation request tx submitted: ${validationReqTxId}`);

  await pollTransaction(
    circleClient,
    validationReqTxId,
    "validationRequest(address,uint256,string,bytes32)"
  );

  // ----------------------------------------------------------
  // Step 7b: Validation Response (Validator responds)
  // ----------------------------------------------------------
  console.log("\n=== STEP 7b: Submitting Validation Response ===");

  const validationResTxResponse =
    await circleClient.createContractExecutionTransaction({
      walletId: validatorWallet.id,
      contractAddress: VALIDATION_REGISTRY,
      abiFunctionSignature:
        "validationResponse(bytes32,uint8,string,bytes32,string)",
      abiParameters: [
        requestHash,
        "100",
        "",
        ("0x" + "0".repeat(64)) as `0x${string}`,
        "kyc_verified",
      ],
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });

  const validationResTxId = (validationResTxResponse as any)?.data?.id as
    | string
    | undefined;
  if (!validationResTxId) {
    throw new Error(
      "Failed to submit validationResponse() transaction — no ID returned."
    );
  }
  console.log(`Validation response tx submitted: ${validationResTxId}`);

  await pollTransaction(
    circleClient,
    validationResTxId,
    "validationResponse(bytes32,uint8,string,bytes32,string)"
  );

  // ----------------------------------------------------------
  // Step 7c: Read final validation status from chain
  // ----------------------------------------------------------
  console.log("\n=== STEP 7c: Reading Final Validation Status ===");

  const validationContract = getContract({
    address: VALIDATION_REGISTRY,
    abi: VALIDATION_REGISTRY_ABI,
    client: publicClient,
  });

  const [score, passed, notes] =
    await validationContract.read.getValidationStatus([requestHash]);

  console.log(`\n--- Validation Result ---`);
  console.log(`  Score:  ${score}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Notes:  ${notes}`);

  // ----------------------------------------------------------
  // Done
  // ----------------------------------------------------------
  console.log("\n=== All steps completed successfully! ===");
  console.log({
    agentId,
    ownerAddress: ownerWallet.address,
    validatorAddress: validatorWallet.address,
    tokenURI: tokenURIValue,
    onChainOwner,
    validationScore: score,
    validationPassed: passed,
    validationNotes: notes,
  });
}

main().catch((err) => {
  console.error("\n[ERROR]", err);
  process.exit(1);
});
