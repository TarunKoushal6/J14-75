import "dotenv/config";

export const mockAuditTool = {
  type: "function" as const,
  function: {
    name: "audit_contract",
    description:
      "Run a security audit on a smart contract address. Returns a risk assessment with findings and recommendations. Use when the user asks to audit a contract, check if a contract is safe, or analyze a smart contract.",
    parameters: {
      type: "object",
      properties: {
        contractAddress: {
          type: "string",
          description: "The smart contract address (0x...) to audit.",
        },
        blockchain: {
          type: "string",
          enum: ["ETH-SEPOLIA", "ARC-TESTNET"],
          description: "The blockchain network where the contract is deployed.",
        },
        contractName: {
          type: "string",
          description: "Optional: Known name or label for the contract being audited.",
        },
      },
      required: ["contractAddress", "blockchain"],
    },
  },
};

const KNOWN_CONTRACTS: Record<string, { name: string; riskScore: number; status: string }> = {
  "0x8004a818bfb912233c491871b3d84c89a494bd9e": {
    name: "ERC-8004 IdentityRegistry",
    riskScore: 95,
    status: "SAFE",
  },
  "0x8004b663056a597dffe9eccc1965a193b7388713": {
    name: "ERC-8004 ReputationRegistry",
    riskScore: 92,
    status: "SAFE",
  },
  "0x8004cb1bf31daf7788923b405b754f57aceb4272": {
    name: "ERC-8004 ValidationRegistry",
    riskScore: 94,
    status: "SAFE",
  },
};

export async function handleMockAudit(args: {
  contractAddress: string;
  blockchain: "ETH-SEPOLIA" | "ARC-TESTNET";
  contractName?: string;
}): Promise<string> {
  await new Promise((r) => setTimeout(r, 800));

  const normalizedAddr = args.contractAddress.toLowerCase();
  const known = KNOWN_CONTRACTS[normalizedAddr];

  if (known) {
    return JSON.stringify({
      success: true,
      contractAddress: args.contractAddress,
      blockchain: args.blockchain,
      contractName: known.name,
      riskScore: known.riskScore,
      status: known.status,
      findings: [
        {
          severity: "INFO",
          title: "ERC-8004 Compliant",
          description: "Contract implements the ERC-8004 AI Agent Identity standard correctly.",
        },
        {
          severity: "INFO",
          title: "Circle Infrastructure",
          description: "Deployed and verified on Arc Testnet via Circle Developer-Controlled Wallets.",
        },
      ],
      summary: `${known.name} is a known safe contract on Arc Testnet. Risk score: ${known.riskScore}/100.`,
    });
  }

  const riskScore = Math.floor(Math.random() * 30) + 60;
  const hasRisk = riskScore < 80;

  const findings = [
    {
      severity: hasRisk ? "MEDIUM" : "LOW",
      title: hasRisk ? "Unverified Source Code" : "Unverified on Explorer",
      description: hasRisk
        ? "Contract source code is not verified on the block explorer. Cannot confirm implementation matches ABI."
        : "Contract is not verified on the block explorer, but appears functional.",
    },
    {
      severity: "INFO",
      title: "On-Chain Activity",
      description: `Contract at ${args.contractAddress} has been deployed and is callable on ${args.blockchain}.`,
    },
  ];

  if (hasRisk) {
    findings.push({
      severity: "HIGH",
      title: "Unknown Contract Pattern",
      description:
        "Contract does not match any known safe patterns. Exercise caution before interacting with significant funds.",
    });
  }

  return JSON.stringify({
    success: true,
    contractAddress: args.contractAddress,
    blockchain: args.blockchain,
    contractName: args.contractName ?? "Unknown Contract",
    riskScore,
    status: hasRisk ? "CAUTION" : "LOW_RISK",
    findings,
    summary: `Risk score: ${riskScore}/100. ${hasRisk ? "Exercise caution — source not verified." : "Low risk — appears safe for standard interactions."}`,
    disclaimer:
      "This is a mock audit for demonstration. In production, J14-75 would integrate with Slither, MythX, or on-chain verification APIs.",
  });
}
