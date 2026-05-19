// J14-75 Circle / Arc operation helpers
// Uses Circle Developer-Controlled Wallets for Arc Testnet wallet creation and
// direct Arc Testnet signing/broadcasting. App Kit helpers are exposed as stable
// wrapper names for the agent layer.

import { createPublicClient, http, Address } from "viem";
import { arcTestnet } from "viem/chains";
import { AppKit } from "@circle-fin/app-kit";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import { getOrCreateCircleWallet } from "./circle-client.js";

export const ARC_TESTNET_CHAIN_ID = 5042002;
export const ARC_TESTNET_RPC_URL = process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network";
export const ARC_TESTNET_EXPLORER_URL = "https://testnet.arcscan.app";
export const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as Address;
export const ARC_EURC_ADDRESS = (process.env.ARC_EURC_ADDRESS || "") as Address;

export const arcClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_TESTNET_RPC_URL),
});

const kit = new AppKit();
let circleWalletsAdapter: ReturnType<typeof createCircleWalletsAdapter> | null = null;

function getCircleWalletsAdapter() {
  if (circleWalletsAdapter) return circleWalletsAdapter;
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET || process.env.CIRCLE_ENTITY_KEY;
  if (!apiKey || !entitySecret) {
    throw new Error("CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET are required for App Kit Circle Wallets adapter.");
  }
  circleWalletsAdapter = createCircleWalletsAdapter({ apiKey, entitySecret });
  return circleWalletsAdapter;
}

function normalizeArcChain(chain: string) {
  return resolveChain(chain) === "Arc_Testnet" ? "Arc_Testnet" : resolveChain(chain);
}

function describeKitError(err: any): string {
  const payload = err?.response?.data ?? err?.cause?.response?.data ?? err?.cause ?? err;
  const msg = payload?.message ?? err?.message ?? "Unknown App Kit error";
  const code = payload?.code ?? err?.code;
  const details = payload && typeof payload === "object" ? JSON.stringify(payload).slice(0, 500) : "";
  return [msg, code ? `code ${code}` : "", details && !details.includes(msg) ? details : ""].filter(Boolean).join(" | ");
}

export async function getOrCreateAgentWallet(userAddress: string) {
  return getOrCreateCircleWallet(userAddress);
}

export async function appKitSend(params: {
  circleWalletId?: string;
  circleAddress: string;
  recipient: string;
  amount: string;
  token: string;
}) {
  const token = params.token.toUpperCase();
  const adapter = getCircleWalletsAdapter();
  const tokenParam = token === "EURC" ? (ARC_EURC_ADDRESS || "EURC") : token;

  try {
    const result = await kit.send({
      from: { adapter, chain: "Arc_Testnet", address: params.circleAddress },
      to: params.recipient,
      amount: params.amount,
      token: tokenParam as any,
    } as any);

    const txHash = (result as any).txHash ?? (result as any).hash ?? "";
    return {
      txHash,
      explorerUrl: (result as any).explorerUrl ?? (txHash ? `${ARC_TESTNET_EXPLORER_URL}/tx/${txHash}` : ""),
    };
  } catch (err: any) {
    throw new Error(`App Kit send failed: ${describeKitError(err)}`);
  }
}

export async function appKitBridge(params: {
  circleAddress: string;
  fromChain: string;
  toChain: string;
  amount: string;
}): Promise<{ txHash: string; steps: any[] }> {
  throw new Error(
    `CCTP bridge route requested (${params.fromChain} → ${params.toChain}, ${params.amount} USDC), but this build only enables safe Arc Testnet transfers. Add Circle Bridge Kit route config before enabling bridge execution.`
  );
}

export async function appKitSwap(params: {
  circleAddress: string;
  chain: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  gasSponsorPolicyId?: string;
}): Promise<{ txHash: string; steps: any[]; explorerUrl?: string; amountOut?: string }> {
  const adapter = getCircleWalletsAdapter();
  const chain = normalizeArcChain(params.chain);
  try {
    const result = await kit.swap({
      from: { adapter, chain, address: params.circleAddress },
      tokenIn: params.tokenIn.toUpperCase() as any,
      tokenOut: params.tokenOut.toUpperCase() as any,
      amountIn: params.amountIn,
      config: {
        kitKey: process.env.KIT_KEY,
        allowanceStrategy: "permit",
        slippageBps: 300,
      } as any,
    } as any);

    return {
      txHash: (result as any).txHash ?? "",
      explorerUrl: (result as any).explorerUrl,
      amountOut: (result as any).amountOut,
      steps: [{ name: "swap", state: "success", txHash: (result as any).txHash }],
    };
  } catch (err: any) {
    throw new Error(`App Kit swap failed: ${describeKitError(err)}`);
  }
}

export function resolveChain(chainName: string): string {
  const key = chainName.toLowerCase();
  const chainMap: Record<string, string> = {
    arc_testnet: "Arc_Testnet",
    "arc-testnet": "Arc_Testnet",
    arc: "Arc_Testnet",
    ethereum: "Ethereum",
    eth: "Ethereum",
    polygon: "Polygon",
    matic: "Polygon",
    base: "Base",
    arbitrum: "Arbitrum",
    avalanche: "Avalanche",
    optimism: "Optimism",
    solana: "Solana",
  };
  return chainMap[key] || chainName;
}

export default {
  getOrCreateAgentWallet,
  appKitSend,
  appKitBridge,
  appKitSwap,
  resolveChain,
};
