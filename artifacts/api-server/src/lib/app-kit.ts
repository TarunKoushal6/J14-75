import { AppKit } from "@circle-fin/app-kit";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import { getOrCreateCircleWallet } from "./circle-client.js";

// AppKit can be initialized without constructor options; adapters/env provide runtime config.
const kit = new AppKit();
const ARC_NATIVE_TOKEN_SYMBOL = "USDC";

let adapter: ReturnType<typeof createCircleWalletsAdapter> | null = null;

function getCircleAdapter() {
  if (adapter) return adapter;

  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET || process.env.CIRCLE_ENTITY_KEY;

  if (!apiKey || !entitySecret) {
    throw new Error("CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET are required.");
  }

  adapter = createCircleWalletsAdapter({
    apiKey,
    entitySecret,
  });

  return adapter;
}

type AppKitChainIdentifier =
  | "Arc_Testnet"
  | "Ethereum"
  | "Polygon"
  | "Base"
  | "Arbitrum"
  | "Optimism"
  | "Avalanche"
  | "Solana";

function toAppKitChain(chainName: string): AppKitChainIdentifier {
  // AppKit expects Arc testnet as "Arc_Testnet" (official enum casing).
  const key = chainName.trim().toLowerCase();
  if (key === "arc" || key === "arc_testnet" || key === "arc-testnet") return "Arc_Testnet";
  if (key === "ethereum" || key === "eth") return "Ethereum";
  if (key === "polygon" || key === "matic") return "Polygon";
  if (key === "base") return "Base";
  if (key === "arbitrum") return "Arbitrum";
  if (key === "optimism") return "Optimism";
  if (key === "avalanche") return "Avalanche";
  if (key === "solana") return "Solana";
  return "Arc_Testnet";
}

/**
 * Returns or creates a Circle developer-controlled wallet mapped to the input identifier.
 */
export async function getOrCreateAgentWallet(userAddress: string) {
  return getOrCreateCircleWallet(userAddress);
}

/**
 * Send tokens on Arc Testnet using AppKit send.
 */
export async function appKitSend(params: {
  circleAddress: string;
  recipient: string;
  amount: string;
  token: string;
}) {
  const { circleAddress, recipient, amount, token } = params;
  const normalizedToken = token.toUpperCase();
  const result = await kit.send({
    from: {
      adapter: getCircleAdapter(),
      address: circleAddress,
      chain: toAppKitChain("Arc_Testnet"),
    },
    to: recipient,
    amount,
    token: normalizedToken === ARC_NATIVE_TOKEN_SYMBOL ? "NATIVE" : normalizedToken,
  });

  return {
    txHash: result.txHash ?? "",
    explorerUrl:
      result.explorerUrl ??
      (result.txHash ? `https://testnet.arcscan.app/tx/${result.txHash}` : ""),
  };
}

/**
 * Bridge USDC cross-chain with AppKit bridge.
 */
export async function appKitBridge(params: {
  circleAddress: string;
  fromChain: string;
  toChain: string;
  amount: string;
}) {
  const { circleAddress, fromChain, toChain, amount } = params;
  const result = await kit.bridge({
    from: {
      adapter: getCircleAdapter(),
      address: circleAddress,
      chain: toAppKitChain(fromChain),
    },
    to: {
      adapter: getCircleAdapter(),
      address: circleAddress,
      chain: toAppKitChain(toChain),
    },
    amount,
    token: "USDC",
  });

  const txHash = result.steps.find((s) => !!s.txHash)?.txHash ?? "";
  return { txHash, steps: result.steps };
}

/**
 * Swap tokens on supported chains using AppKit swap.
 */
export async function appKitSwap(params: {
  circleAddress: string;
  chain: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
}) {
  const { circleAddress, chain, tokenIn, tokenOut, amountIn } = params;

  const result = await kit.swap({
    from: {
      adapter: getCircleAdapter(),
      address: circleAddress,
      chain: toAppKitChain(chain),
    },
    tokenIn: tokenIn.toUpperCase() as any,
    tokenOut: tokenOut.toUpperCase() as any,
    amountIn,
  });

  return {
    txHash: result.txHash,
    steps: [
      {
        name: "swap",
        state: "success",
        txHash: result.txHash,
        explorerUrl: result.explorerUrl,
      },
    ],
  };
}

export function resolveChain(chainName: string): string {
  const key = chainName.trim().toLowerCase();
  if (key === "arc" || key === "arc-testnet" || key === "arc_testnet") return "Arc_Testnet";
  if (key === "ethereum" || key === "eth") return "Ethereum";
  if (key === "polygon" || key === "matic") return "Polygon";
  if (key === "base") return "Base";
  if (key === "arbitrum") return "Arbitrum";
  if (key === "optimism") return "Optimism";
  if (key === "avalanche") return "Avalanche";
  if (key === "solana") return "Solana";
  return chainName;
}

export { kit };

export default {
  kit,
  getOrCreateAgentWallet,
  appKitSend,
  appKitBridge,
  appKitSwap,
  resolveChain,
};
