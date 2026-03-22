import "dotenv/config";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

export const walletManagerTool = {
  type: "function" as const,
  function: {
    name: "manage_wallet",
    description:
      "Create a new developer-controlled SCA wallet or list existing wallets on a given blockchain. Use this when the user asks to create a wallet, set up a new wallet, or list their wallets.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "list"],
          description: "Whether to create a new wallet or list existing wallets.",
        },
        blockchain: {
          type: "string",
          enum: ["ETH-SEPOLIA", "ARC-TESTNET"],
          description: "Target blockchain for the wallet operation.",
        },
        walletSetId: {
          type: "string",
          description:
            "Optional: The wallet set ID. Required for listing wallets in a specific set.",
        },
      },
      required: ["action", "blockchain"],
    },
  },
};

export async function handleWalletManager(args: {
  action: "create" | "list";
  blockchain: "ETH-SEPOLIA" | "ARC-TESTNET";
  walletSetId?: string;
}): Promise<string> {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

  if (!apiKey || !entitySecret) {
    return "Error: CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET must be set in environment variables.";
  }

  const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

  try {
    if (args.action === "create") {
      const walletSetRes = await client.createWalletSet({
        name: `J14-75 Agent Wallet Set - ${Date.now()}`,
      });
      const walletSetId = (walletSetRes as any)?.data?.walletSet?.id as string | undefined;
      if (!walletSetId) return "Failed to create wallet set — no ID returned.";

      const walletsRes = await client.createWallets({
        blockchains: [args.blockchain] as any,
        count: 1,
        walletSetId,
        accountType: "SCA",
      });
      const wallets = (walletsRes as any)?.data?.wallets as Array<{ id: string; address?: string }> | undefined;
      if (!wallets || wallets.length === 0) return "Failed to create wallet.";

      const w = wallets[0]!;
      return JSON.stringify({
        success: true,
        walletId: w.id,
        address: w.address ?? "pending",
        blockchain: args.blockchain,
        walletSetId,
      });
    } else {
      const walletsRes = await client.listWallets({
        walletSetId: args.walletSetId,
        pageSize: 10,
      } as any);
      const wallets = (walletsRes as any)?.data?.wallets ?? [];
      return JSON.stringify({
        success: true,
        wallets: wallets.map((w: any) => ({
          id: w.id,
          address: w.address,
          blockchain: w.blockchain,
          state: w.state,
        })),
      });
    }
  } catch (err: any) {
    return `Error: ${err?.message ?? String(err)}`;
  }
}
