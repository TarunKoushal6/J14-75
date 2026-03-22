import { createPublicClient, http } from "viem";
import { arcTestnet } from "viem/chains";
import Groq from "groq-sdk";

// Services
import { USDCService } from "./services/usdc-service";
import { ContractService } from "./services/contract-service";
import { DeFiService } from "./services/defi-service";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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

      // Step 4: Validate plan and check requirements
      const validation = await this.validatePlan(plan, context);
      if (!validation.valid) {
        return {
          success: false,
          message: `❌ Cannot execute task: ${validation.reasons.join(", ")}`,
        };
      }

      // Step 5: Return plan (ready for execution)
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
              "tokens": ["USDC", "ETH", "DAI", "WETH", "BTC"],
              "contractTypes": ["ERC20", "ERC721", "ERC1155"]
            }
          }
          
          Rules:
          - If the user implies sending to multiple addresses, include both 'batch' and 'transfer' in taskTypes.
          - If an entity type is not mentioned, leave its array empty [].
          - ONLY output valid JSON. Do not include any markdown formatting or extra text.`,
        },
        { role: "user", content: message },
      ],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
    });

    return JSON.parse(completion.choices[0]?.message?.content || "{}");
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

      if (amount > 1000) warnings.push("⚠️ Large transfer detected - please double-check recipient");
    }

    return {
      steps,
      estimatedGas: steps.reduce((sum, step) => sum + (step.estimated_gas || 0n), 0n),
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
    return { steps, estimatedGas: 0n, requirements: [], warnings: [] };
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

  private async validatePlan(
    plan: TaskPlan,
    context: TaskContext
  ): Promise<{ valid: boolean; reasons: string[] }> {
    const reasons: string[] = [];
    if (!context.userAddress) {
      reasons.push("Wallet not connected");
    }
    return { valid: reasons.length === 0, reasons };
  }
}
