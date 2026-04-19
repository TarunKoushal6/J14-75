import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import {
  createPublicClient,
  http,
  serializeTransaction,
  formatUnits,
  erc20Abi,
  Address,
  encodeFunctionData,
} from "viem";
import { arcTestnet } from "viem/chains";

// ──────────────────────────────────────────────────────────────────────────────
// Arc Testnet public client (for broadcasting and receipt polling)
// ──────────────────────────────────────────────────────────────────────────────
export const arcPublicClient = createPublicClient({
  chain: arcTestnet,
  transport: http("https://rpc.testnet.arc.network"),
});

// ──────────────────────────────────────────────────────────────────────────────
// Circle Developer-Controlled Wallets SDK client
// Initialised lazily so the app still boots without credentials (for tests)
// ──────────────────────────────────────────────────────────────────────────────
let circleClient: ReturnType<typeof initiateDeveloperControlledWalletsClient> | null = null;

// Helper to clean API key (remove TEST_API_KEY: prefix if present)
function cleanApiKey(apiKey: string | undefined): string {
  if (!apiKey) return "";
  // Remove common prefixes that might be added
  const prefixes = ["TEST_API_KEY:", "LIVE_API_KEY:", "api_key:", "key:"];
  let cleaned = apiKey.trim();
  for (const prefix of prefixes) {
    if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) {
      cleaned = cleaned.slice(prefix.length);
    }
  }
  return cleaned.trim();
}

export function getCircleClient() {
  if (circleClient) return circleClient;

  // Clean the API key to remove any prefixes
  const rawApiKey = process.env.CIRCLE_API_KEY;
  const apiKey = cleanApiKey(rawApiKey);
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET || process.env.CIRCLE_ENTITY_KEY;

  if (!apiKey || !entitySecret) {
    console.error("❌ Missing Circle credentials:");
    console.error("  CIRCLE_API_KEY:", rawApiKey ? "[set but may be invalid]" : "[not set]");
    console.error("  CIRCLE_ENTITY_SECRET/CIRCLE_ENTITY_KEY:", entitySecret ? "[set]" : "[not set]");
    throw new Error(
      "CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET environment variables are required for Circle SDK."
    );
  }

  console.log("🔑 Using Circle API Key:", apiKey.slice(0, 8) + "..." + apiKey.slice(-4));

  circleClient = initiateDeveloperControlledWalletsClient({
    apiKey,
    entitySecret,
  });

  console.log("✅ Circle Developer-Controlled Wallets SDK initialised.");
  return circleClient;
}

// ──────────────────────────────────────────────────────────────────────────────
// In-memory wallet registry: maps user EOA → Circle walletId + Circle address
// In production this should be persisted to a database.
// ──────────────────────────────────────────────────────────────────────────────
const walletRegistry = new Map<
  string,
  { circleWalletId: string; circleAddress: string }
>();

// App-level wallet set (created once, reused)
let appWalletSetId: string | null = null;

async function getOrCreateWalletSet(): Promise<string> {
  if (appWalletSetId) return appWalletSetId;

  const client = getCircleClient();

  // Try to find an existing wallet set named "J14-75"
  const listRes = await client.listWalletSets({ pageSize: 10 });
  const sets = listRes.data?.walletSets ?? [];
  const existing = sets.find((ws: any) => ws.name === "J14-75-AgentWallets");

  if (existing?.id) {
    appWalletSetId = existing.id;
    console.log(`♻️  Reusing Circle wallet set: ${appWalletSetId}`);
    return appWalletSetId!;
  }

  // Create a new wallet set
  const createRes = await client.createWalletSet({
    name: "J14-75-AgentWallets",
    idempotencyKey: `wallet-set-j1475-${Date.now()}`,
  });

  appWalletSetId = createRes.data?.walletSet?.id ?? null;
  if (!appWalletSetId) {
    throw new Error("Failed to create Circle wallet set.");
  }

  console.log(`✅ Created Circle wallet set: ${appWalletSetId}`);
  return appWalletSetId;
}

/**
 * Returns (or creates) a Circle developer-controlled wallet for a given user.
 * The wallet is keyed by the user's connected wallet address (e.g. MetaMask).
 */
export async function getOrCreateCircleWallet(userAddress: string): Promise<{
  circleWalletId: string;
  circleAddress: string;
}> {
  const lower = userAddress.toLowerCase();

  // Return cached entry
  if (walletRegistry.has(lower)) {
    return walletRegistry.get(lower)!;
  }

  const client = getCircleClient();
  const walletSetId = await getOrCreateWalletSet();

  // Search for an existing wallet with this user's address in its metadata
  const listRes = await client.listWallets({
    walletSetId,
    pageSize: 50,
  });

  const wallets = listRes.data?.wallets ?? [];
  const match = wallets.find(
    (w: any) =>
      w.refId === lower ||
      w.address?.toLowerCase() === lower ||
      (w.metadata && JSON.parse(w.metadata || "{}").userAddress === lower)
  );

  if (match) {
    const entry = {
      circleWalletId: match.id,
      circleAddress: match.address,
    };
    walletRegistry.set(lower, entry);
    console.log(
      `♻️  Reusing Circle wallet ${match.id} (${match.address}) for user ${userAddress}`
    );
    return entry;
  }

  // Create a new wallet for this user
  const createRes = await client.createWallets({
    blockchains: ["ARC-TESTNET"] as any,
    count: 1,
    walletSetId,
    metadata: [
      {
        name: `J14-75 Agent Wallet for ${userAddress.slice(0, 8)}`,
        refId: lower,
      },
    ],
  } as any);

  const newWallet = createRes.data?.wallets?.[0];
  if (!newWallet?.id || !newWallet?.address) {
    throw new Error("Circle wallet creation failed — no wallet returned.");
  }

  const entry = {
    circleWalletId: newWallet.id,
    circleAddress: newWallet.address,
  };
  walletRegistry.set(lower, entry);
  console.log(
    `✅ Created Circle wallet ${newWallet.id} (${newWallet.address}) for user ${userAddress}`
  );
  return entry;
}

// ──────────────────────────────────────────────────────────────────────────────
// SIGN with Circle + BROADCAST to Arc Testnet via viem
// Arc Testnet is not on Circle's supported chain list, so we:
//   1. Build the unsigned raw transaction (viem)
//   2. Ask Circle to sign it (Circle SDK – secures the private key server-side)
//   3. Broadcast the signed tx to Arc Testnet (viem sendRawTransaction)
//   4. Wait for on-chain confirmation and return the real txHash
// ──────────────────────────────────────────────────────────────────────────────

export type TransferParams = {
  circleWalletId: string;
  from: Address;
  to: Address;
  amountWei: bigint;
  isNative: boolean;
  tokenAddress?: Address;
  nonce?: number;
};

export async function signAndBroadcastTransfer(
  params: TransferParams
): Promise<string> {
  const client = getCircleClient();
  const { from, to, amountWei, isNative, tokenAddress, circleWalletId } = params;

  // ── 1. Get nonce ────────────────────────────────────────────────────────────
  const nonce =
    params.nonce ??
    (await arcPublicClient.getTransactionCount({ address: from }));

  // ── 2. Estimate gas ────────────────────────────────────────────────────────
  let txData: `0x${string}` = "0x";
  let toAddress: Address = to;
  let value: bigint = 0n;

  if (isNative) {
    value = amountWei;
  } else {
    // ERC-20 transfer calldata
    txData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [to, amountWei],
    });
    toAddress = tokenAddress!;
  }

  const gasEstimate = await arcPublicClient
    .estimateGas({
      account: from,
      to: toAddress,
      value,
      data: txData !== "0x" ? txData : undefined,
    })
    .catch(() => 100_000n);

  const feeData = await arcPublicClient.estimateFeesPerGas().catch(() => ({
    maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
  }));

  // ── 3. Build raw unsigned transaction (EIP-1559) ───────────────────────────
  const unsignedTx = {
    chainId: arcTestnet.id,
    nonce,
    type: "eip1559" as const,
    maxFeePerGas: feeData.maxFeePerGas ?? 1_000_000_000n,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 1_000_000_000n,
    gas: (gasEstimate * 12n) / 10n, // 20% buffer
    to: toAddress,
    value,
    data: txData !== "0x" ? txData : undefined,
  };

  const serialized = serializeTransaction(unsignedTx);
  console.log(`🔏 Sending raw tx to Circle for signing (walletId=${circleWalletId})...`);

  // ── 4. Circle signs the raw EVM transaction ────────────────────────────────
  const signRes = await client.signTransaction({
    walletId: circleWalletId,
    rawTransaction: serialized, // hex-encoded EIP-1559 serialised tx
    memo: `J14-75 transfer to ${to}`,
  });

  const signedTxHex = signRes.data?.signedTransaction;
  if (!signedTxHex) {
    throw new Error("Circle did not return a signed transaction.");
  }

  console.log(`✍️  Circle signed tx: ${signedTxHex.slice(0, 20)}...`);

  // ── 5. Broadcast to Arc Testnet ───────────────────────────────────────────
  const txHash = await arcPublicClient.sendRawTransaction({
    serializedTransaction: signedTxHex as `0x${string}`,
  });

  console.log(`📡 Broadcast to Arc Testnet — txHash: ${txHash}`);

  // ── 6. Wait for on-chain confirmation ─────────────────────────────────────
  const receipt = await arcPublicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: 90_000,
  });

  if (receipt.status !== "success") {
    throw new Error(
      `Transaction reverted on-chain. txHash: ${txHash} | status: ${receipt.status}`
    );
  }

  console.log(`✅ Confirmed on Arc Testnet! Block: ${receipt.blockNumber} | txHash: ${txHash}`);
  return txHash;
}

// ──────────────────────────────────────────────────────────────────────────────
// ERC-20 approve via Circle sign + viem broadcast
// ──────────────────────────────────────────────────────────────────────────────
export async function signAndBroadcastApproval(params: {
  circleWalletId: string;
  from: Address;
  tokenAddress: Address;
  spender: Address;
  amountWei: bigint;
}): Promise<string> {
  const { circleWalletId, from, tokenAddress, spender, amountWei } = params;
  const client = getCircleClient();

  const txData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, amountWei],
  });

  const nonce = await arcPublicClient.getTransactionCount({ address: from });

  const gasEstimate = await arcPublicClient
    .estimateGas({ account: from, to: tokenAddress, data: txData })
    .catch(() => 80_000n);

  const feeData = await arcPublicClient.estimateFeesPerGas().catch(() => ({
    maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
  }));

  const unsignedTx = {
    chainId: arcTestnet.id,
    nonce,
    type: "eip1559" as const,
    maxFeePerGas: feeData.maxFeePerGas ?? 1_000_000_000n,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 1_000_000_000n,
    gas: (gasEstimate * 12n) / 10n,
    to: tokenAddress,
    value: 0n,
    data: txData,
  };

  const serialized = serializeTransaction(unsignedTx);

  const signRes = await client.signTransaction({
    walletId: circleWalletId,
    rawTransaction: serialized,
    memo: `Approve ${spender} to spend token`,
  });

  const signedTxHex = signRes.data?.signedTransaction;
  if (!signedTxHex) throw new Error("Circle did not return signed approval tx.");

  const txHash = await arcPublicClient.sendRawTransaction({
    serializedTransaction: signedTxHex as `0x${string}`,
  });

  const receipt = await arcPublicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: 90_000,
  });

  if (receipt.status !== "success") {
    throw new Error(`Approval reverted on-chain. txHash: ${txHash}`);
  }

  console.log(`✅ Approval confirmed! txHash: ${txHash}`);
  return txHash;
}

// ──────────────────────────────────────────────────────────────────────────────
// Blockscout / ArcscanAPI helpers
// ──────────────────────────────────────────────────────────────────────────────
// Arc Testnet Blockscout API - using the official Arc testnet explorer
const ARCSCAN_BASE = "https://explorer.testnet.arc.network/api/v2";

function getBlockscoutApiKey(): string | null {
  return process.env.BLOCKSCOUT_API_KEY ?? null;
}

export async function fetchTokenBalances(userAddress: string): Promise<string> {
  // Arc Testnet Blockscout doesn't require API key for read operations
  const url = `${ARCSCAN_BASE}/addresses/${userAddress}/token-balances`;
  console.log(`📦 ArcscanAPI → token-balances for ${userAddress}`);

  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`ArcscanAPI error ${res.status}: ${body.slice(0, 200)}`);
    return `⚠️ Failed to fetch token balances (HTTP ${res.status}). The Arc Testnet explorer may be temporarily unavailable.`;
  }

  const data = (await res.json()) as any;
  const tokens: any[] = data.items ?? data.result ?? [];

  // Also fetch native balance (Arc USDC is native gas token - 18 decimals for gas, 6 for ERC-20)
  const nativeUrl = `${ARCSCAN_BASE}/addresses/${userAddress}`;
  let nativeBalance = "0";
  try {
    const nativeRes = await fetch(nativeUrl);
    if (nativeRes.ok) {
      const nativeData = (await nativeRes.json()) as any;
      const raw = nativeData.coin_balance ?? nativeData.balance ?? "0";
      // Native USDC on Arc uses 18 decimals for gas, but balance display is same as ERC-20
      nativeBalance = formatUnits(BigInt(raw), 18);
    }
  } catch {}

  const lines: string[] = [`• USDC (native): ${parseFloat(nativeBalance).toFixed(4)}`];

  for (const item of tokens) {
    try {
      const symbol = item.token?.symbol ?? item.symbol ?? "UNKNOWN";
      const decimals = parseInt(item.token?.decimals ?? item.decimals ?? "18", 10);
      const raw = item.value ?? item.token_value ?? "0";
      const balance = formatUnits(BigInt(raw), decimals);
      const addr = (item.token?.address ?? item.token_address ?? "0x????").slice(0, 8);
      lines.push(`• ${symbol} (${addr}...): ${parseFloat(balance).toFixed(4)}`);
    } catch {
      lines.push(`• ${item.token?.symbol ?? "?"}: (parse error)`);
    }
  }

  return `✅ Balances on Arc Testnet:\n${lines.join("\n")}`;
}

export async function fetchTransactionHistory(userAddress: string): Promise<string> {
  // Arc Testnet Blockscout doesn't require API key for read operations
  const url = `${ARCSCAN_BASE}/addresses/${userAddress}/transactions`;
  console.log(`📜 ArcscanAPI → transactions for ${userAddress}`);

  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`ArcscanAPI error ${res.status}: ${body.slice(0, 200)}`);
    return `⚠️ Failed to fetch transaction history (HTTP ${res.status}). The Arc Testnet explorer may be temporarily unavailable.`;
  }

  const data = (await res.json()) as any;
  const txs: any[] = data.items ?? data.result ?? [];

  if (txs.length === 0) {
    return "✅ No transactions found for this address on Arc Testnet.";
  }

  const rows = txs.slice(0, 10).map((tx: any) => {
    try {
      const ts = parseInt(tx.block_timestamp ?? tx.timestamp ?? "0");
      const date = ts > 0 ? new Date(ts * 1000).toLocaleString() : "unknown date";
      const ok = tx.result === "success" || tx.status === "ok" ? "✅" : "❌";
      const hash = (tx.hash ?? tx.transaction_hash ?? "").slice(0, 12) + "...";
      const from = (tx.from?.hash ?? tx.from_address ?? "0x????").slice(0, 8) + "...";
      const to = (tx.to?.hash ?? tx.to_address ?? "0x????").slice(0, 8) + "...";
      return `${ok} ${date} | ${hash} | ${from} → ${to}`;
    } catch {
      return "• (parse error)";
    }
  });

  return `✅ Last ${Math.min(10, txs.length)} transactions:\n${rows.join("\n")}`;
}
