/**
 * Arc App Kit integration for J14-75
 *
 * Uses the official Arc App Kit SDK for all on-chain execution:
 *  - kit.send()   → token transfers on Arc Testnet
 *  - kit.bridge() → cross-chain USDC via CCTP (Arc ↔ other chains)
 *  - kit.swap()   → NOT supported on Arc Testnet (testnet limitation per Arc docs)
 *
 * Adapter: @circle-fin/adapter-circle-wallets
 *   – Connects to Circle Developer-Controlled Wallets
 *   – Requires CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET
 *   – No raw private keys needed; Circle manages key custody
 *
 * Docs: https://docs.arc.network/app-kit
 */

import { AppKit } from "@circle-fin/app-kit";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

// Singleton App Kit instance
export const kit = new AppKit();

// ──────────────────────────────────────────────────────────────────────────────
// Build the Circle Wallets adapter (server-side, no private key needed)
// ──────────────────────────────────────────────────────────────────────────────
export function buildCircleAdapter() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

  if (!apiKey || !entitySecret) {
    throw new Error(
      "CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET must be set to execute on-chain transactions."
    );
  }

  return createCircleWalletsAdapter({ apiKey, entitySecret });
}

// ──────────────────────────────────────────────────────────────────────────────
// Wallet registry: user connected address → Circle wallet info
// In production this should live in a database.
// ──────────────────────────────────────────────────────────────────────────────
const walletRegistry = new Map<
  string, // key: userAddress.toLowerCase()
  { circleWalletId: string; circleAddress: string }
>();

let appWalletSetId: string | null = null;

function getCircleClient() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) {
    throw new Error("CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET are required.");
  }
  return initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
}

async function ensureWalletSet(): Promise<string> {
  if (appWalletSetId) return appWalletSetId;
  const client = getCircleClient();

  const listRes = await client.listWalletSets({ pageSize: 10 });
  const existing = (listRes.data?.walletSets ?? []).find(
    (ws: any) => ws.name === "J14-75-AppKit"
  );
  if (existing?.id) {
    appWalletSetId = existing.id;
    return appWalletSetId!;
  }

  const res = await client.createWalletSet({
    name: "J14-75-AppKit",
    idempotencyKey: `j1475-appkit-walletset-${Date.now()}`,
  });
  appWalletSetId = res.data?.walletSet?.id ?? null;
  if (!appWalletSetId) throw new Error("Failed to create Circle wallet set.");
  console.log(`✅ Circle wallet set created: ${appWalletSetId}`);
  return appWalletSetId;
}

/**
 * Returns (or creates) a Circle developer-controlled wallet for a given user.
 * The returned circleAddress is the on-chain address used with App Kit.
 */
export async function getOrCreateAgentWallet(userAddress: string): Promise<{
  circleWalletId: string;
  circleAddress: string;
}> {
  const key = userAddress.toLowerCase();
  if (walletRegistry.has(key)) return walletRegistry.get(key)!;

  const client = getCircleClient();
  const walletSetId = await ensureWalletSet();

  // Search existing wallets for a refId match
  const listRes = await client.listWallets({ walletSetId, pageSize: 50 });
  const match = (listRes.data?.wallets ?? []).find(
    (w: any) => w.refId === key
  );

  if (match?.id && match?.address) {
    const entry = { circleWalletId: match.id, circleAddress: match.address };
    walletRegistry.set(key, entry);
    console.log(`♻️  Reusing Circle wallet ${match.id} for user ${userAddress}`);
    return entry;
  }

  // Create a new wallet
  const createRes = await client.createWallets({
    blockchains: ["ETH"] as any,
    count: 1,
    walletSetId,
    metadata: [
      { name: `J14-75 Agent (${userAddress.slice(0, 8)})`, refId: key },
    ],
  } as any);

  const w = createRes.data?.wallets?.[0];
  if (!w?.id || !w?.address) {
    throw new Error("Circle wallet creation returned no wallet.");
  }

  const entry = { circleWalletId: w.id, circleAddress: w.address };
  walletRegistry.set(key, entry);
  console.log(`✅ Circle wallet created: ${w.id} (${w.address})`);
  return entry;
}

// ──────────────────────────────────────────────────────────────────────────────
// SEND — transfer tokens via App Kit
// ──────────────────────────────────────────────────────────────────────────────
export type SendOptions = {
  circleAddress: string;
  recipient: string;
  amount: string;
  token?: string;
};

export async function appKitSend(opts: SendOptions): Promise<{
  txHash: string;
  explorerUrl: string;
}> {
  const adapter = buildCircleAdapter();

  console.log(
    `📤 kit.send(): ${opts.amount} ${opts.token ?? "USDC"} → ${opts.recipient} from Circle wallet ${opts.circleAddress}`
  );

  const result = await kit.send({
    from: {
      adapter,
      chain: "Arc_Testnet",
      address: opts.circleAddress,
    },
    to: opts.recipient,
    amount: opts.amount,
    token: opts.token ?? "USDC",
  });

  console.log("✅ kit.send() result:", JSON.stringify(result, null, 2));

  const txHash =
    (result as any).txHash ??
    (result as any).steps?.[result.steps.length - 1]?.txHash ??
    "";

  const explorerUrl = txHash
    ? `https://testnet.arcscan.app/tx/${txHash}`
    : "";

  if (!txHash) {
    throw new Error(
      `kit.send() completed but returned no txHash. Full result: ${JSON.stringify(result)}`
    );
  }

  return { txHash, explorerUrl };
}

// ──────────────────────────────────────────────────────────────────────────────
// BRIDGE — cross-chain USDC via CCTP using App Kit
// ──────────────────────────────────────────────────────────────────────────────
export type BridgeOptions = {
  circleAddress: string;
  fromChain: string; // App Kit chain identifier e.g. "Ethereum_Sepolia"
  toChain: string;   // App Kit chain identifier e.g. "Arc_Testnet"
  amount: string;
};

/**
 * Maps user-friendly chain names to Arc App Kit chain identifiers.
 * Reference: https://docs.arc.network/app-kit/references/supported-blockchains
 */
export function resolveChain(name: string): string {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const map: Record<string, string> = {
    arc: "Arc_Testnet",
    arctestnet: "Arc_Testnet",
    ethereum: "Ethereum_Sepolia",
    eth: "Ethereum_Sepolia",
    sepolia: "Ethereum_Sepolia",
    ethsepolia: "Ethereum_Sepolia",
    base: "Base_Sepolia",
    basesepolia: "Base_Sepolia",
    arbitrum: "Arbitrum_Sepolia",
    arb: "Arbitrum_Sepolia",
    polygon: "Polygon_Amoy",
    matic: "Polygon_Amoy",
    avalanche: "Avalanche_Fuji",
    avax: "Avalanche_Fuji",
    solana: "Solana_Devnet",
    sol: "Solana_Devnet",
  };
  return map[n] ?? name;
}

export async function appKitBridge(opts: BridgeOptions): Promise<{
  txHash: string;
  steps: any[];
}> {
  const adapter = buildCircleAdapter();
  const fromChainId = resolveChain(opts.fromChain);
  const toChainId = resolveChain(opts.toChain);

  console.log(
    `🌉 kit.bridge(): ${opts.amount} USDC | ${fromChainId} → ${toChainId} | wallet ${opts.circleAddress}`
  );

  const result = await kit.bridge({
    from: {
      adapter,
      chain: fromChainId as any,
      address: opts.circleAddress,
    },
    to: {
      adapter,
      chain: toChainId as any,
      address: opts.circleAddress,
    },
    amount: opts.amount,
  });

  console.log("✅ kit.bridge() result:", JSON.stringify(result, null, 2));

  const steps = (result as any).steps ?? [];
  const lastTxHash =
    steps[steps.length - 1]?.txHash ?? (result as any).txHash ?? "";

  return { txHash: lastTxHash, steps };
}
