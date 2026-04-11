// J14-75 App Kit Integration
// Wrapper around Circle App Kit for Arc Testnet operations

import { AppKit } from "@circle-fin/app-kit";
import { createPublicClient, http, formatUnits, parseUnits, Address } from "viem";
import { arcTestnet } from "viem/chains";

type LegacyKit = AppKit & {
  walletSetId?: string;
  listWallets: (params: { walletSetId: string; refId: string }) => Promise<Array<{ id: string; address: string }>>;
  createWallets: (params: {
    walletSetId: string;
    blockchains: string[];
    count: number;
    refId: string;
    metadata?: { name: string };
  }) => Promise<Array<{ id: string; address: string }>>;
  send: (params: unknown) => Promise<{ transactionHash: string }>;
  bridge: (params: unknown) => Promise<{ transactionHash: string; steps?: unknown[] }>;
  swap: (params: unknown) => Promise<{ transactionHash: string; steps?: unknown[] }>;
};

// Initialize App Kit with testnet configuration
// The current integration expects legacy helper methods on `kit`.
// Keep this permissive wrapper until the full AppKit adapter migration is complete.
// TODO(j14-75): Replace this legacy typed wrapper with AppKit + Circle adapter contexts
// (`from: { adapter, chain }`) and remove compatibility-only methods.
export const kit: LegacyKit = new AppKit() as LegacyKit;

// Arc Testnet public client for balance checks
const arcClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

/**
 * Get or create the agent's Circle wallet for a user
 * Maps user's connected address (MetaMask) to Circle wallet
 */
export async function getOrCreateAgentWallet(userAddress: string) {
  if (!kit.walletSetId) {
    throw new Error("Wallet Set ID not configured");
  }

  try {
    // Check if wallet already exists for this user
    const wallets = await kit.listWallets({
      walletSetId: kit.walletSetId,
      refId: userAddress.toLowerCase(),
    });

    if (wallets.length > 0) {
      const wallet = wallets[0];
      return {
        circleWalletId: wallet.id,
        circleAddress: wallet.address,
      };
    }

    // Create new wallet for user
    const newWallet = await kit.createWallets({
      walletSetId: kit.walletSetId,
      blockchains: ["ETH"], // EVM compatible for Arc Testnet
      count: 1,
      refId: userAddress.toLowerCase(),
      metadata: {
        name: `J14-75 Agent Wallet for ${userAddress.slice(0, 8)}`,
      },
    });

    return {
      circleWalletId: newWallet[0].id,
      circleAddress: newWallet[0].address,
    };
  } catch (error) {
    console.error("Failed to get/create agent wallet:", error);
    throw error;
  }
}

/**
 * Send tokens using kit.send()
 * Supports native USDC (Arc) and ERC-20 transfers
 */
export async function appKitSend(params: {
  circleAddress: string; // User's Circle wallet address
  recipient: string; // Recipient address
  amount: string; // Amount in human-readable format (e.g., "5.00")
  token: string; // Token symbol (USDC, EURC, etc.)
}) {
  const { circleAddress, recipient, amount, token } = params;

  // Determine if token is native or ERC-20 on Arc Testnet
  const isNative = token === "USDC"; // USDC is native gas on Arc Testnet
  const decimals = isNative ? 18 : 6; // Native: 18, ERC-20: 6

  // Parse amount to smallest unit
  const amountWei = parseUnits(amount, decimals);

  // Use kit.send for execution
  const result = await kit.send({
    walletAddress: circleAddress,
    to: recipient as Address,
    amount: amountWei.toString(),
    tokenId: isNative ? undefined : token, // undefined for native, token symbol for ERC-20
    options: {
      // Enable gas sponsorship for email users if configured
      sponsored: !!process.env.GAS_STATION_POLICY_ID,
    },
  });

  return {
    txHash: result.transactionHash,
    explorerUrl: `https://explorer.testnet.arc.network/tx/${result.transactionHash}`,
  };
}

/**
 * Bridge USDC between chains using kit.bridge() (CCTP)
 */
export async function appKitBridge(params: {
  circleAddress: string; // User's Circle wallet address
  fromChain: string; // Source chain (e.g., "Arc_Testnet", "Ethereum")
  toChain: string; // Destination chain
  amount: string; // Amount in USDC (6 decimals)
}) {
  const { circleAddress, fromChain, toChain, amount } = params;

  // Parse amount (USDC uses 6 decimals)
  const amountWei = parseUnits(amount, 6);

  const result = await kit.bridge({
    walletAddress: circleAddress,
    fromChain: fromChain,
    toChain: toChain,
    amount: amountWei.toString(),
    options: {
      sponsored: !!process.env.GAS_STATION_POLICY_ID,
    },
  });

  return {
    txHash: result.transactionHash,
    steps: result.steps || [],
  };
}

/**
 * Swap tokens using kit.swap() (mainnet only, with Gas Station)
 */
export async function appKitSwap(params: {
  circleAddress: string; // User's Circle wallet address
  chain: string; // Destination chain (e.g., "Ethereum", "Polygon")
  tokenIn: string; // Input token symbol
  tokenOut: string; // Output token symbol
  amountIn: string; // Input amount in human-readable format
  gasSponsorPolicyId?: string; // Optional Gas Station policy ID
}) {
  const { circleAddress, chain, tokenIn, tokenOut, amountIn, gasSponsorPolicyId } = params;

  // Parse amount based on input token (assume 6 decimals for USDC/USDT, etc.)
  // In production, you'd look up token decimals
  const amountWei = parseUnits(amountIn, 6);

  const result = await kit.swap({
    walletAddress: circleAddress,
    chain: chain,
    fromToken: tokenIn,
    toToken: tokenOut,
    amount: amountWei.toString(),
    options: {
      sponsored: !!gasSponsorPolicyId,
      policyId: gasSponsorPolicyId,
    },
  });

  return {
    txHash: result.transactionHash,
    steps: result.steps || [],
  };
}

/**
 * Resolve chain name to Chain ID or standard identifier
 */
export function resolveChain(chainName: string): string {
  const chainMap: Record<string, string> = {
    "Arc_Testnet": "Arc_Testnet",
    "arc-testnet": "Arc_Testnet",
    "arc": "Arc_Testnet",
    "Ethereum": "Ethereum",
    "ethereum": "Ethereum",
    "eth": "Ethereum",
    "Polygon": "Polygon",
    "polygon": "Polygon",
    "matic": "Polygon",
    "Base": "Base",
    "base": "Base",
    "Arbitrum": "Arbitrum",
    "arbitrum": "Arbitrum",
    "avalanche": "Avalanche",
    "Optimism": "Optimism",
    "optimism": "Optimism",
    "solana": "Solana",
  };

  return chainMap[chainName.toLowerCase()] || chainName;
}

export default {
  kit,
  getOrCreateAgentWallet,
  appKitSend,
  appKitBridge,
  appKitSwap,
  resolveChain,
};
