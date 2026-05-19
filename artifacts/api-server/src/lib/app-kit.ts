// J14-75 Circle / Arc operation helpers
// Uses Circle Developer-Controlled Wallets for Arc Testnet wallet creation and
// direct Arc Testnet signing/broadcasting. App Kit helpers are exposed as stable
// wrapper names for the agent layer.

import { createPublicClient, http, formatUnits, parseUnits, Address, erc20Abi } from "viem";
import { arcTestnet } from "viem/chains";
import { getOrCreateCircleWallet, signAndBroadcastTransfer, createCircleTransfer } from "./circle-client.js";

export const ARC_TESTNET_CHAIN_ID = 5042002;
export const ARC_TESTNET_RPC_URL = process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network";
export const ARC_TESTNET_EXPLORER_URL = "https://testnet.arcscan.app";
export const ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as Address;
export const ARC_EURC_ADDRESS = (process.env.ARC_EURC_ADDRESS || "") as Address;

export const arcClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_TESTNET_RPC_URL),
});

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
  const isNative = token === "USDC";
  const tokenAddress = token === "EURC" ? ARC_EURC_ADDRESS : undefined;

  if (token === "EURC" && !tokenAddress) {
    throw new Error("ARC_EURC_ADDRESS is not configured.");
  }

  const circleWalletId = params.circleWalletId ?? (await getOrCreateCircleWallet(params.circleAddress)).circleWalletId;

  // Prefer Circle SDK-native transfer. Raw signTransaction is a fallback only;
  // Circle rejects some custom Arc raw tx payloads with 400.
  const sdkTokenAddress = token === "EURC" ? tokenAddress! : ARC_USDC_ADDRESS;
  const sdkTx = await createCircleTransfer({
    circleWalletId,
    recipient: params.recipient,
    amount: params.amount,
    tokenAddress: sdkTokenAddress,
    blockchain: "ARC-TESTNET",
  });

  return {
    txHash: sdkTx.txHash || sdkTx.transactionId,
    explorerUrl: sdkTx.txHash ? `${ARC_TESTNET_EXPLORER_URL}/tx/${sdkTx.txHash}` : `Circle transaction: ${sdkTx.transactionId} (${sdkTx.state})`,
  };
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
}): Promise<{ txHash: string; steps: any[] }> {
  throw new Error(
    `Swap requested (${params.amountIn} ${params.tokenIn} → ${params.tokenOut} on ${params.chain}), but swap execution is disabled on Arc Testnet. Circle App Kit swaps are mainnet route dependent; configure supported chain routes before enabling.`
  );
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
