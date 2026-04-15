import { AppKit } from "@circle-fin/app-kit";
import {
  ArcTestnet,
  Arbitrum,
  Avalanche,
  Base,
  Ethereum,
  Optimism,
  Polygon,
  Solana,
} from "@circle-fin/app-kit/chains";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import type { ChainDefinition } from "@circle-fin/app-kit";
import { getOrCreateCircleWallet } from "./circle-client.js";

const kit = new AppKit();

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

function chainFromName(chainName: string): ChainDefinition {
  const key = chainName.trim().toLowerCase();
  if (key === "arc" || key === "arc_testnet" || key === "arc-testnet") return ArcTestnet;
  if (key === "ethereum" || key === "eth") return Ethereum;
  if (key === "polygon" || key === "matic") return Polygon;
  if (key === "base") return Base;
  if (key === "arbitrum") return Arbitrum;
  if (key === "optimism") return Optimism;
  if (key === "avalanche") return Avalanche;
  if (key === "solana") return Solana;
  return ArcTestnet;
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
  const result = await kit.send({
    from: {
      adapter: getCircleAdapter(),
      address: circleAddress,
      chain: ArcTestnet,
    },
    to: recipient,
    amount,
    token: token.toUpperCase() === "USDC" ? "NATIVE" : token.toUpperCase(),
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
      chain: chainFromName(fromChain),
    },
    to: {
      adapter: getCircleAdapter(),
      address: circleAddress,
      chain: chainFromName(toChain),
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
      chain: chainFromName(chain),
    },
    tokenIn: tokenIn.toUpperCase() as any,
    tokenOut: tokenOut.toUpperCase() as any,
    amount: amountIn,
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
