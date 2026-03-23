import {
  createPublicClient,
  http,
  erc20Abi,
  parseUnits,
  formatUnits,
} from "viem";
import { arcTestnet } from "viem/chains";
import Groq from "groq-sdk";

// Services
import { USDCService } from "./services/usdc-service";
import { ContractService } from "./services/contract-service";
import { DeFiService } from "./services/defi-service";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ==========================================
// 💾 HARDCODED KNOWN TOKENS (NO INDEXER NEEDED)
// ==========================================
const KNOWN_TOKENS: Record<
  string,
  { address: string; decimals: number; symbol: string }
> = {
  USDC: {
    address: "native", // USDC is native on Arc Testnet
    decimals: 18,
    symbol: "USDC",
  },
  EURC: {
    address: process.env.ARC_EURC_ADDRESS || "EURC_NOT_DEPLOYED",
    decimals: 6,
    symbol: "EURC",
  },
};

interface TaskContext {
  userAddress: string;
  message: string;
  chainId: number;
  walletClient?: any;
}

interface TaskResult {
  success: boolean;
  message: string;
  txHash?: string;
  data?: any;
  followUpActions?: string[];
}

interface TaskPlan {
  steps: TaskStep[];
  estimatedGas: bigint;
  requirements: string[];
  warnings: string[];
}

interface TaskStep {
  id: string;
  description: string;
  action: string;
  params: any;
  dependencies: string[];
  estimated_gas?: bigint;
}

export class IntelligentAgent {
  private publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(),
  });

  private usdcService = new USDCService();
  private contractService = new ContractService();
  private defiService = new DeFiService();

  async processComplexTask(context: TaskContext): Promise<TaskResult> {
    try {
      console.log("🤖 Analyzing task with Groq AI:", context.message);

      // Step 1 & 2: Analyze intent and extract entities using LLM
      const aiAnalysis = await this.analyzeWithAI(context.message);
      console.log("🔍 Groq Extracted Entities & Intent:", aiAnalysis);

      const taskTypes = aiAnalysis.taskTypes || ["query"];
      const entities = aiAnalysis.entities || {};

      // Step 3: Create execution plan based on AI output
      const plan = await this.createExecutionPlan(taskTypes, entities, context);
      console.log("📝 Execution plan:", plan);

      // Step 4: Validate plan and check REAL on-chain requirements
      const validation = await this.validatePlan(plan, context);
      if (!validation.valid) {
        return {
          success: false,
          message: `❌ Cannot execute task: ${validation.reasons.join(", ")}`,
        };
      }

      // Step 5: Execute plan with REAL wallet signing
      if (context.walletClient && this.shouldExecute(taskTypes)) {
        try {
          const txHash = await this.executeTaskOnChain(plan, context);
          return {
            success: true,
            message: `✅ Transaction executed! TxHash: ${txHash}`,
            txHash,
            data: plan,
          };
        } catch (execError: any) {
          return {
            success: false,
            message: `❌ Execution failed: ${
              execError instanceof Error
                ? execError.message
                : "Unknown error"
            }`,
            data: plan,
          };
        }
      }

      // Return plan if no wallet available or just for preview
      return {
        success: true,
        message: `Plan Ready! Here is what I will execute: \n\n${plan.steps
          .map((s) => `✅ ${s.description}`)
          .join("\n")}`,
        data: plan,
      };
    } catch (error) {
      console.error("Agent error:", error);
      return {
        success: false,
        message: `🚨 Error processing task: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  // ==========================================
  // 🧠 AI BRAIN: Powered by Groq (Llama 3.3-70B)
  // ==========================================
  private async analyzeWithAI(message: string) {
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are an advanced Web3 AI Planner operating on the Arc Testnet.
          Analyze the user's message and extract their intent and entities into a STRICT JSON object.
          
          Required JSON format:
          {
            "taskTypes": ["swap" | "transfer" | "deploy" | "liquidity" | "batch" | "analyze" | "query"],
            "entities": {
              "addresses": ["0x..."],
              "amounts": [number],
              "tokens": ["USDC", "EURC", "ETH"],
              "contractTypes": ["ERC20", "ERC721", "ERC1155"]
            }
          }
          
          Rules:
          - If the user implies sending to multiple addresses, include both 'batch' and 'transfer' in taskTypes.
          - If an entity type is not mentioned, leave its array empty [].
          - ONLY output valid JSON. Do not include any markdown formatting or extra text.
          - Token names MUST be from: USDC, EURC. Other tokens are not supported on Arc Testnet.`,
        },
        { role: "user", content: message },
      ],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
    });

    return JSON.parse(completion.choices[0]?.message?.content || "{}");
  }

  // ==========================================
  // 🔐 REAL ON-CHAIN BALANCE VALIDATION
  // ==========================================
  private async getTokenBalance(
    userAddress: string,
    token: string
  ): Promise<bigint> {
    const tokenInfo = KNOWN_TOKENS[token];
    if (!tokenInfo)
      throw new Error(`Unsupported token: ${token}. Only USDC and EURC supported.`);

    if (tokenInfo.address === "native") {
      // Native USDC balance (getBalance)
      return await this.publicClient.getBalance({
        address: userAddress as `0x${string}`,
      });
    } else if (tokenInfo.address !== "EURC_NOT_DEPLOYED") {
      // ERC-20 token balance (readContract)
      const balance = await this.publicClient.readContract({
        address: tokenInfo.address as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [userAddress as `0x${string}`],
      });
      return balance as bigint;
    }
    throw new Error(
      `Token ${token} not deployed on Arc Testnet (ARC_EURC_ADDRESS not set)`
    );
  }

  // ==========================================
  // 💰 REAL WALLET EXECUTION (NOT MOCKED)
  // ==========================================
  private async executeTaskOnChain(
    plan: TaskPlan,
    context: TaskContext
  ): Promise<string> {
    if (!context.walletClient) throw new Error("No wallet client available");

    // Execute first step that requires on-chain action
    const execStep = plan.steps.find((s) =>
      ["transfer", "swap", "approve", "deploy"].includes(s.action)
    );
    if (!execStep) throw new Error("No executable step in plan");

    let txHash: string | undefined;

    // TRANSFER: Send real transaction via walletClient
    if (execStep.action === "transfer") {
      const { recipient, amount } = execStep.params;
      const amountWei = parseUnits(amount.toString(), 18); // USDC is 18 decimals

      // ✅ PRE-CHECK: Validate balance BEFORE prompting wallet
      const balance = await this.getTokenBalance(context.userAddress, "USDC");
      if (balance < amountWei) {
        throw new Error(
          `Insufficient USDC balance. You have ${formatUnits(
            balance,
            18
          )}, but need ${amount}`
        );
      }

      // Send real transaction — prompts wallet (MetaMask)
      txHash = await context.walletClient.sendTransaction({
        account: context.userAddress,
        to: recipient,
        value: amountWei,
      });
    }

    // APPROVE: Approve ERC-20 spending for DEX
    if (execStep.action === "approve") {
      const { token, amount, spender } = execStep.params;
      const tokenInfo = KNOWN_TOKENS[token];
      if (!tokenInfo || tokenInfo.address === "native") {
        throw new Error(`Cannot approve native token`);
      }

      // ✅ PRE-CHECK: Validate balance
      const balance = await this.getTokenBalance(context.userAddress, token);
      const amountWei = parseUnits(amount.toString(), tokenInfo.decimals);
      if (balance < amountWei) {
        throw new Error(
          `Insufficient ${token} balance. You have ${formatUnits(
            balance,
            tokenInfo.decimals
          )}, but need ${amount}`
        );
      }

      // Send real approval transaction
      txHash = await context.walletClient.writeContract({
        account: context.userAddress,
        address: tokenInfo.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [spender as `0x${string}`, amountWei],
      });
    }

    // SWAP: Placeholder (real swap would use DEX interface)
    if (execStep.action === "swap") {
      const { fromToken, amount } = execStep.params;

      // ✅ PRE-CHECK: Validate balance
      const balance = await this.getTokenBalance(
        context.userAddress,
        fromToken
      );
      const tokenInfo = KNOWN_TOKENS[fromToken];
      const amountWei = parseUnits(amount.toString(), tokenInfo.decimals);
      if (balance < amountWei) {
        throw new Error(
          `Insufficient ${fromToken} balance. You have ${formatUnits(
            balance,
            tokenInfo.decimals
          )}, but need ${amount}`
        );
      }

      // Real swap would be signed here (using DEX contract interface)
      throw new Error("Swap execution requires DEX integration");
    }

    if (!txHash) throw new Error("Transaction signing cancelled or failed");

    // ✅ WAIT FOR REAL ON-CHAIN RECEIPT (NOT MOCKED)
    console.log(`⏳ Waiting for receipt for txHash: ${txHash}`);
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash as `0x${string}`,
      timeout: 60_000,
    });

    if (receipt.status !== "success") {
      throw new Error(
        `Transaction reverted on-chain. TxHash: ${txHash}. Status: ${receipt.status}`
      );
    }

    console.log(`✅ Transaction confirmed on Arc Testnet: ${txHash}`);
    return txHash;
  }

  private shouldExecute(taskTypes: string[]): boolean {
    return taskTypes.some((t) =>
      ["transfer", "swap", "approve", "deploy"].includes(t)
    );
  }

  // ==========================================
  // PLANNER FUNCTIONS
  // ==========================================

  private async createExecutionPlan(
    taskTypes: string[],
    entities: Record<string, any>,
    context: TaskContext
  ): Promise<TaskPlan> {
    if (taskTypes.includes("swap") && entities.tokens)
      return await this.createSwapPlan(entities, context);
    if (taskTypes.includes("transfer") && entities.addresses && entities.amounts)
      return await this.createTransferPlan(entities, context);
    if (taskTypes.includes("deploy") && entities.contractTypes)
      return await this.createDeploymentPlan(entities, context);
    if (taskTypes.includes("liquidity"))
      return await this.createLiquidityPlan(entities, context);
    if (taskTypes.includes("batch"))
      return await this.createBatchPlan(entities, context);
    if (taskTypes.includes("analyze"))
      return await this.createAnalysisPlan(entities, context);

    return {
      steps: [
        {
          id: "query",
          description: "Process user query",
          action: "respond",
          params: { message: context.message },
          dependencies: [],
        },
      ],
      estimatedGas: 0n,
      requirements: [],
      warnings: [],
    };
  }

  private async createSwapPlan(
    entities: Record<string, any>,
    context: TaskContext
  ): Promise<TaskPlan> {
    const steps: TaskStep[] = [];
    const requirements = [
      "Connected wallet",
      "Sufficient token balance",
      "DEX contract approval",
    ];
    const warnings: string[] = [];

    if (
      entities.amounts &&
      entities.tokens &&
      entities.tokens.length >= 2
    ) {
      const [fromToken, toToken] = entities.tokens;
      const amount = entities.amounts[0];

      steps.push({
        id: "check_balance",
        description: `Check ${fromToken} balance`,
        action: "checkBalance",
        params: { token: fromToken, amount },
        dependencies: [],
      });
      steps.push({
        id: "approve_token",
        description: `Approve ${fromToken} spending`,
        action: "approve",
        params: { token: fromToken, amount, spender: "DEX_CONTRACT" },
        dependencies: ["check_balance"],
        estimated_gas: 50000n,
      });
      steps.push({
        id: "execute_swap",
        description: `Swap ${amount} ${fromToken} for ${toToken}`,
        action: "swap",
        params: { fromToken, toToken, amount },
        dependencies: ["approve_token"],
        estimated_gas: 200000n,
      });

      warnings.push("⚠️ Swaps involve slippage and price impact");
      warnings.push("💡 Consider splitting large swaps to reduce impact");
    }

    return { steps, estimatedGas: 250000n, requirements, warnings };
  }

  private async createTransferPlan(
    entities: Record<string, any>,
    context: TaskContext
  ): Promise<TaskPlan> {
    const steps: TaskStep[] = [];
    const requirements = [
      "Connected wallet",
      "Sufficient USDC balance",
      "Valid recipient address",
    ];
    const warnings: string[] = [];

    if (entities.addresses && entities.amounts) {
      const recipient = entities.addresses[0];
      const amount = entities.amounts[0];

      if (entities.addresses.length > 1 || entities.amounts.length > 1) {
        steps.push({
          id: "batch_transfer",
          description: `Batch transfer to ${entities.addresses.length} recipients`,
          action: "batchTransfer",
          params: {
            recipients: entities.addresses,
            amounts: entities.amounts,
          },
          dependencies: [],
          estimated_gas: BigInt(100000 * entities.addresses.length),
        });
      } else {
        steps.push({
          id: "single_transfer",
          description: `Transfer ${amount} USDC to ${recipient.slice(0, 6)}...`,
          action: "transfer",
          params: { recipient, amount },
          dependencies: [],
          estimated_gas: 65000n,
        });
      }

      if (amount > 1000)
        warnings.push(
          "⚠️ Large transfer detected - please double-check recipient"
        );
    }

    return {
      steps,
      estimatedGas: steps.reduce(
        (sum, step) => sum + (step.estimated_gas || 0n),
        0n
      ),
      requirements,
      warnings,
    };
  }

  private async createDeploymentPlan(
    entities: Record<string, any>,
    context: TaskContext
  ): Promise<TaskPlan> {
    const steps: TaskStep[] = [];
    const requirements = [
      "Connected wallet",
      "Sufficient gas (USDC)",
      "Valid contract code",
    ];
    const warnings = [
      "⚠️ Contract deployment is permanent",
      "💡 Consider using verified templates",
    ];

    if (entities.contractTypes) {
      const contractType = entities.contractTypes[0].toUpperCase();
      steps.push({
        id: "prepare_contract",
        description: `Prepare ${contractType} contract`,
        action: "prepareContract",
        params: { type: contractType, config: entities },
        dependencies: [],
      });
      steps.push({
        id: "deploy_contract",
        description: `Deploy ${contractType} contract`,
        action: "deploy",
        params: { type: contractType },
        dependencies: ["prepare_contract"],
        estimated_gas: 2000000n,
      });
      steps.push({
        id: "verify_deployment",
        description: "Verify contract deployment",
        action: "verify",
        params: { contract: "deployed_address" },
        dependencies: ["deploy_contract"],
      });
    }

    return { steps, estimatedGas: 2100000n, requirements, warnings };
  }

  private async createLiquidityPlan(
    entities: Record<string, any>,
    context: TaskContext
  ): Promise<TaskPlan> {
    const steps: TaskStep[] = [];
    steps.push({
      id: "check_pair",
      description: "Check liquidity pair exists",
      action: "checkPair",
      params: { tokens: entities.tokens },
      dependencies: [],
    });
    steps.push({
      id: "add_liquidity",
      description: "Add liquidity to pool",
      action: "addLiquidity",
      params: { tokens: entities.tokens, amounts: entities.amounts },
      dependencies: ["check_pair"],
      estimated_gas: 300000n,
    });

    return {
      steps,
      estimatedGas: 300000n,
      requirements: ["Connected wallet", "Token balances", "DEX approval"],
      warnings: [
        "⚠️ Impermanent loss risk",
        "💡 Understand LP token mechanics",
      ],
    };
  }

  private async createBatchPlan(
    entities: Record<string, any>,
    context: TaskContext
  ): Promise<TaskPlan> {
    const steps: TaskStep[] = [];
    if (entities.addresses && entities.amounts) {
      steps.push({
        id: "batch_operation",
        description: `Execute batch operation for ${entities.addresses.length} transactions`,
        action: "batch",
        params: { operations: this.createBatchOperations(entities) },
        dependencies: [],
        estimated_gas: BigInt(80000 * entities.addresses.length),
      });
    }
    return {
      steps,
      estimatedGas: BigInt(80000 * (entities.addresses?.length || 1)),
      requirements: [
        "Connected wallet",
        "Sufficient balance for all operations",
      ],
      warnings: [
        "⚠️ Batch operations cost more gas",
        "💡 Review all recipients carefully",
      ],
    };
  }

  private async createAnalysisPlan(
    entities: Record<string, any>,
    context: TaskContext
  ): Promise<TaskPlan> {
    const steps: TaskStep[] = [];
    if (entities.addresses) {
      steps.push({
        id: "analyze_address",
        description: `Analyze address ${entities.addresses[0]}`,
        action: "analyzeAddress",
        params: { address: entities.addresses[0] },
        dependencies: [],
      });
    }
    steps.push({
      id: "generate_report",
      description: "Generate analysis report",
      action: "report",
      params: { type: "analysis" },
      dependencies: ["analyze_address"],
    });
    return {
      steps,
      estimatedGas: 0n,
      requirements: [],
      warnings: [],
    };
  }

  private createBatchOperations(entities: Record<string, any>): any[] {
    const operations = [];
    const addresses = entities.addresses || [];
    const amounts = entities.amounts || [];
    for (let i = 0; i < addresses.length; i++) {
      operations.push({
        type: "transfer",
        to: addresses[i],
        amount: amounts[i] || amounts[0] || 1,
      });
    }
    return operations;
  }

  // ==========================================
  // ✅ ENHANCED VALIDATION WITH REAL BALANCE CHECKS
  // ==========================================
  private async validatePlan(
    plan: TaskPlan,
    context: TaskContext
  ): Promise<{ valid: boolean; reasons: string[] }> {
    const reasons: string[] = [];

    // Check wallet connected
    if (!context.userAddress) {
      reasons.push("Wallet not connected");
      return { valid: false, reasons };
    }

    // PRE-CHECK: For transfers, validate real balance from blockchain
    const transferStep = plan.steps.find((s) => s.action === "transfer");
    if (transferStep) {
      try {
        const amount = transferStep.params.amount || 0;
        const balance = await this.getTokenBalance(context.userAddress, "USDC");
        const required = parseUnits(amount.toString(), 18);

        if (balance < required) {
          reasons.push(
            `Insufficient USDC balance. You have ${formatUnits(
              balance,
              18
            )}, but need ${amount}`
          );
        }
      } catch (err: any) {
        reasons.push(`Balance check failed: ${err.message}`);
      }
    }

    // PRE-CHECK: For token operations, validate token is in KNOWN_TOKENS
    const tokens = plan.steps
      .flatMap((s) => [
        s.params.token,
        s.params.fromToken,
        s.params.toToken,
      ])
      .filter(Boolean);

    for (const token of tokens) {
      if (!KNOWN_TOKENS[token]) {
        reasons.push(
          `Unsupported token: ${token}. Only USDC and EURC supported on Arc Testnet.`
        );
      }
    }

    return { valid: reasons.length === 0, reasons };
  }
}
