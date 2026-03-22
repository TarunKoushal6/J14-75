import "dotenv/config";
import { createPublicClient, http, formatUnits, type Address } from "viem";
import { sepolia, arcTestnet } from "viem/chains";

const USDC_ADDRESSES: Record<string, Address> = {
  "ETH-SEPOLIA": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  "ARC-TESTNET": "0x8005f18f4E014a87f5F37ba1D2d0A6b3692c0bf1",
};

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export const checkBalanceTool = {
  type: "function" as const,
  function: {
    name: "check_balance",
    description:
      "Check the native ETH and USDC balance of a wallet address on ETH-SEPOLIA or ARC-TESTNET. Use when the user asks about their balance, funds, or how much they have.",
    parameters: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "The wallet address (0x...) to check the balance for.",
        },
        blockchain: {
          type: "string",
          enum: ["ETH-SEPOLIA", "ARC-TESTNET"],
          description: "The blockchain network to check the balance on.",
        },
      },
      required: ["address", "blockchain"],
    },
  },
};

export async function handleCheckBalance(args: {
  address: string;
  blockchain: "ETH-SEPOLIA" | "ARC-TESTNET";
}): Promise<string> {
  try {
    const chain = args.blockchain === "ETH-SEPOLIA" ? sepolia : arcTestnet;
    const client = createPublicClient({ chain, transport: http() });

    const ethBalance = await client.getBalance({ address: args.address as Address });

    let usdcBalance = "N/A";
    const usdcAddress = USDC_ADDRESSES[args.blockchain];
    if (usdcAddress) {
      try {
        const [rawBalance, decimals] = await Promise.all([
          client.readContract({
            address: usdcAddress,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [args.address as Address],
          }),
          client.readContract({
            address: usdcAddress,
            abi: ERC20_ABI,
            functionName: "decimals",
          }),
        ]);
        usdcBalance = formatUnits(rawBalance, decimals) + " USDC";
      } catch {
        usdcBalance = "USDC contract not available on this network";
      }
    }

    return JSON.stringify({
      success: true,
      address: args.address,
      blockchain: args.blockchain,
      ethBalance: formatUnits(ethBalance, 18) + " ETH",
      usdcBalance,
    });
  } catch (err: any) {
    return `Error checking balance: ${err?.message ?? String(err)}`;
  }
}
