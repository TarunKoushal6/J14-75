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

const fetchJson = globalThis.fetch as unknown as (input: string, init?: RequestInit) => Promise<any>;

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

function normalizeApiKey(apiKey: string | undefined): string {
  // Circle Developer-Controlled Wallets API keys must keep their full
  // PREFIX:ID:SECRET shape (for example TEST_API_KEY:...:...).
  // Do not strip the prefix; that causes Circle SDK auth to fail with 401.
  return (apiKey ?? "").trim();
}

export function getCircleClient() {
  if (circleClient) return circleClient;

  const rawApiKey = process.env.CIRCLE_API_KEY;
  const apiKey = normalizeApiKey(rawApiKey);
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

export function describeCircleError(err: any): string {
  const payload = err?.response?.data ?? err?.error?.response?.data ?? err?.data ?? err?.error;
  const status = err?.status ?? err?.response?.status ?? err?.error?.response?.status;
  const code = err?.code ?? payload?.code;
  const circleMsg = payload?.message ?? payload?.error ?? payload?.errors?.[0]?.message;
  const msg = circleMsg ?? err?.message ?? "Unknown Circle error";
  const details = payload && typeof payload === "object" ? JSON.stringify(payload).slice(0, 1000) : "";
  const stackTop = err?.stack ? String(err.stack).split("\n").slice(0, 4).join(" | ") : "";
  const parts = [msg];
  if (status) parts.push(`status ${status}`);
  if (code) parts.push(`code ${code}`);
  if (details && !details.includes(msg)) parts.push(details);
  if (stackTop && !stackTop.includes(msg)) parts.push(stackTop);
  return parts.join(" | ");
}

export async function createCircleTransfer(params: {
  circleWalletId: string;
  recipient: string;
  amount: string;
  tokenAddress: string;
  blockchain?: string;
}): Promise<{ txHash: string; transactionId: string; state: string }> {
  const client = getCircleClient();
  try {
    const createRes = await client.createTransaction({
      walletId: params.circleWalletId,
      destinationAddress: params.recipient,
      amount: [params.amount],
      tokenAddress: params.tokenAddress,
      fee: { type: "level", config: { feeLevel: "HIGH" } } as any,
      idempotencyKey: crypto.randomUUID(),
    } as any);

    const tx = (createRes as any).data?.transaction ?? (createRes as any).data;
    const transactionId = tx?.id;
    if (!transactionId) throw new Error("Circle createTransaction did not return transaction id.");

    let state = tx?.state ?? "INITIATED";
    let txHash = tx?.txHash ?? "";
    for (let i = 0; i < 45 && !txHash && !["COMPLETE", "FAILED", "DENIED", "CANCELLED"].includes(state); i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await client.getTransaction({ id: transactionId } as any);
      const ptx = (poll as any).data?.transaction ?? (poll as any).data;
      state = ptx?.state ?? state;
      txHash = ptx?.txHash ?? txHash;
    }

    if (["FAILED", "DENIED", "CANCELLED"].includes(state)) {
      throw new Error(`Circle transaction ${state}. id=${transactionId}`);
    }
    return { txHash, transactionId, state };
  } catch (err: any) {
    throw new Error(`Circle transfer failed: ${describeCircleError(err)}`);
  }
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
  const listRes = await client.listWalletSets();
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
  let stage = "init";
  try {
  const lower = userAddress.toLowerCase();

  // Return cached entry
  if (walletRegistry.has(lower)) {
    return walletRegistry.get(lower)!;
  }

  const client = getCircleClient();
  const walletSetId = await getOrCreateWalletSet();

  stage = "listWallets";

  // Search for an existing wallet with this user's address in its metadata
  const listRes = await client.listWallets({
    walletSetId,
    refId: lower,
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
  stage = "createWallets";
  const createRes = await client.createWallets({
    blockchains: ["ARC-TESTNET"] as any,
    count: 1,
    walletSetId,
    metadata: [
      {
        name: `J14-75 ${userAddress.slice(0, 8)}`,
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
  } catch (err: any) {
    throw new Error(`Circle wallet mapping failed (${stage}): ${describeCircleError(err)}`);
  }
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
  const address = userAddress as Address;

  // Prefer direct Arc RPC. Explorer APIs are optional and may be unavailable.
  try {
    const [nativeRaw, erc20Raw] = await Promise.all([
      arcPublicClient.getBalance({ address }),
      arcPublicClient.readContract({
        address: (process.env.ARC_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000") as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      } as any) as Promise<bigint>,
    ]);

    const nativeBalance = formatUnits(nativeRaw, 18);
    const erc20Balance = formatUnits(erc20Raw, 6);

    return [
      "✅ Balances on Arc Testnet:",
      `• USDC (ERC-20): ${Number(erc20Balance).toLocaleString(undefined, { maximumFractionDigits: 6 })}`,
      `• USDC (native gas): ${Number(nativeBalance).toLocaleString(undefined, { maximumFractionDigits: 6 })}`,
      "",
      "Source: Arc Testnet RPC",
    ].join("\n");
  } catch (rpcErr: any) {
    console.error("Arc RPC balance fetch failed:", rpcErr?.message ?? rpcErr);
  }

  // Best-effort explorer fallback only. Never throw raw fetch errors to UI.
  try {
    const url = `${ARCSCAN_BASE}/addresses/${userAddress}/token-balances`;
    console.log(`📦 ArcscanAPI → token-balances for ${userAddress}`);
    const res = await fetchJson(url);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`ArcscanAPI error ${res.status}: ${body.slice(0, 200)}`);
      return `⚠️ Balance unavailable right now. Arc RPC and explorer both failed. Please try again in a minute.`;
    }

    const data = (await res.json()) as any;
    const tokens: any[] = data.items ?? data.result ?? [];
    const lines: string[] = [];
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
    return `✅ Balances on Arc Testnet:\n${lines.length ? lines.join("\n") : "• No token balances found."}`;
  } catch (err: any) {
    console.error("Balance fetch failed:", err?.message ?? err);
    return `⚠️ Balance unavailable right now. Arc data source failed: ${err?.message ?? "unknown error"}.`;
  }
}

export async function fetchTransactionHistory(userAddress: string): Promise<string> {
  const address = userAddress as Address;

  // Direct RPC cannot list full transaction history without an indexer, but it can
  // provide reliable account activity basics even when explorer APIs are down.
  try {
    const [blockNumber, txCount] = await Promise.all([
      arcPublicClient.getBlockNumber(),
      arcPublicClient.getTransactionCount({ address }),
    ]);

    // Best-effort explorer attempt for recent rows. If it fails, return RPC facts.
    try {
      const url = `${ARCSCAN_BASE}/addresses/${userAddress}/transactions`;
      console.log(`📜 ArcscanAPI → transactions for ${userAddress}`);
      const res = await fetchJson(url);
      if (res.ok) {
        const data = (await res.json()) as any;
        const txs: any[] = data.items ?? data.result ?? [];
        if (txs.length > 0) {
          const rows = txs.slice(0, 10).map((tx: any) => {
            const ts = parseInt(tx.block_timestamp ?? tx.timestamp ?? "0");
            const date = ts > 0 ? new Date(ts * 1000).toLocaleString() : "unknown date";
            const ok = tx.result === "success" || tx.status === "ok" ? "✅" : "❌";
            const hash = tx.hash ?? tx.tx_hash ?? "?";
            return `${ok} ${hash.slice(0, 10)}… — ${date}`;
          });
          return `✅ Recent Arc Testnet transactions:\n${rows.join("\n")}`;
        }
      }
    } catch (explorerErr: any) {
      console.warn("Arc explorer transaction history unavailable:", explorerErr?.message ?? explorerErr);
    }

    return [
      "✅ Arc Testnet account activity:",
      `• Address: ${userAddress}`,
      `• Transaction count / nonce: ${txCount}`,
      `• Latest block: ${blockNumber.toString()}`,
      "",
      "Full transaction history requires an explorer indexer; Arc RPC fallback is active.",
    ].join("\n");
  } catch (err: any) {
    console.error("Transaction history fetch failed:", err?.message ?? err);
    return `⚠️ Transaction history unavailable right now: ${err?.message ?? "unknown error"}.`;
  }
}
