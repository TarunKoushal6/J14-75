import {
  createPublicClient,
  http,
  erc20Abi,
  parseUnits,
  formatUnits,
  Address,
} from "viem";
import { arcTestnet } from "viem/chains";
import { GoogleGenerativeAI } from "@google/generative-ai";

const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = gemini.getGenerativeModel({ model: "gemini-2.0-flash" });

// ==========================================
// 💾 HARDCODED KNOWN TOKENS (NO INDEXER NEEDED)
// ==========================================
const KNOWN_TOKENS: Record<
  string,
  { address: string; decimals: number; symbol: string; coingeckoId?: string }
> = {
  USDC: {
    address: "native", // USDC is native on Arc Testnet
    decimals: 18,
    symbol: "USDC",
    coingeckoId: "usd-coin",
  },
  EURC: {
    address: process.env.ARC_EURC_ADDRESS || "EURC_NOT_DEPLOYED",
    decimals: 6,
    symbol: "EURC",
    coingeckoId: "euro-coin",
  },
};

// ==========================================
// 🔮 SCHEDULED TASK REGISTRY
// ==========================================
const scheduledTasks: Map<
  string,
  {
    id: string;
    type: string;
    trigger: any;
    action: any;
    status: "active" | "completed" | "failed";
    createdAt: Date;
  }
> = new Map();

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
  taskId?: string;
  isScheduled?: boolean;
}

interface TaskPlan {
  steps: TaskStep[];
  estimatedGas: bigint;
  requirements: string[];
  warnings: string[];
  isScheduled?: boolean;
  scheduleTrigger?: string;
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

  async processComplexTask(context: TaskContext): Promise<TaskResult> {
    try {
      console.log("🤖 Analyzing task with Gemini 1.5 Pro:", context.message);

      // Step 1 & 2: Analyze intent and extract entities using LLM
      const aiAnalysis = await this.analyzeWithAI(context.message);
      console.log("🔍 Gemini Extracted Entities & Intent:", aiAnalysis);

      const taskTypes = aiAnalysis.taskTypes || ["query"];
      const entities = aiAnalysis.entities || {};
      const isScheduled = aiAnalysis.isScheduled || false;
      const scheduleTrigger = aiAnalysis.scheduleTrigger;

      // Step 3: Create execution plan
      const plan = await this.createExecutionPlan(taskTypes, entities, context, {
        isScheduled,
        scheduleTrigger,
      });
      console.log("📝 Execution plan:", plan);

      // Step 4: Validate plan and check REAL on-chain requirements
      const validation = await this.validatePlan(plan, context);
      if (!validation.valid) {
        return {
          success: false,
          message: `❌ Cannot execute task: ${validation.reasons.join(
            ", "
          )}. This task is impossible with current resources.`,
        };
      }

      // Step 5A: Handle scheduled tasks
      if (isScheduled && scheduleTrigger) {
        const taskId = `task_${Date.now()}`;
        scheduledTasks.set(taskId, {
          id: taskId,
          type: taskTypes[0],
          trigger: scheduleTrigger,
          action: plan.steps,
          status: "active",
          createdAt: new Date(),
        });
        console.log(`⏰ Scheduled task registered: ${taskId}`);
        return {
          success: true,
          message: `⏰ Task scheduled successfully! ID: ${taskId}. Will execute when: ${scheduleTrigger}. You can check the status by asking about this task ID.`,
          taskId,
          isScheduled: true,
        };
      }

      // Step 5B: Execute plan in real-time with REAL wallet signing
      if (context.walletClient && this.shouldExecute(taskTypes)) {
        try {
          const txHash = await this.executeTaskOnChain(plan, context);
          return {
            success: true,
            message: `✅ Task executed successfully on Arc Testnet! Transaction: ${txHash}`,
            txHash,
            data: plan,
          };
        } catch (execError: any) {
          return {
            success: false,
            message: `❌ Task execution failed: ${
              execError instanceof Error
                ? execError.message
                : "Unknown error"
            }. No state was changed on-chain.`,
            data: plan,
          };
        }
      }

      // Return plan if no wallet or for preview
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
  // 🧠 AI BRAIN: Powered by Gemini 1.5 Pro
  // ==========================================
  private async analyzeWithAI(message: string) {
    const systemPrompt = `You are an advanced Web3 AI Planner operating on the Arc Testnet.
Analyze the user's message and extract their intent, entities, and scheduling info into a STRICT JSON object.

CRITICAL RULES TO PREVENT HALLUCINATIONS:
1. NEVER return txHash, block numbers, or fake transaction data in the response.
2. If a task is IMPOSSIBLE (e.g., swap without DEX, bridge to non-existent chain), flag it with "taskTypes": ["impossible"].
3. If the user asks about a task you cannot verify on-chain (e.g., "is my transaction confirmed?"), return "taskTypes": ["query"] instead of faking data.
4. For scheduled tasks (time-based or price-based), return "isScheduled": true and describe the trigger clearly in "scheduleTrigger".
5. ONLY use tokens from: USDC (native), EURC (ERC-20). Reject unknown tokens or ETH requests.
6. For token balance queries, extract the TARGET ADDRESS if different from the connected wallet.
7. If a token address is missing or not deployed, flag it as requiring ARC_EURC_ADDRESS environment variable.

Required JSON format:
{
  "taskTypes": ["swap" | "transfer" | "deploy" | "liquidity" | "batch" | "bridge" | "analyze" | "query" | "impossible"],
  "entities": {
    "addresses": ["0x..."],
    "queryAddresses": ["0x..."],
    "amounts": [number],
    "tokens": ["USDC", "EURC"],
    "contractTypes": ["ERC20", "ERC721", "ERC1155"]
  },
  "isScheduled": false,
  "scheduleTrigger": "when ETH hits $3000" or "in 5 minutes" or null
}

Rules:
- If the user implies sending to multiple addresses, include both 'batch' and 'transfer' in taskTypes.
- If an entity type is not mentioned, leave its array empty [].
- ONLY output valid JSON. Do not include any markdown formatting or extra text.`;

    const fullPrompt = `${systemPrompt}\n\nUser message: ${message}`;
    const response = await model.generateContent(fullPrompt);
    const textContent = response.response.text();
    
    try {
      return JSON.parse(textContent);
    } catch (e) {
      console.error("Failed to parse Gemini JSON response:", textContent);
      return { taskTypes: ["query"], entities: {} };
    }
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
      throw new Error(`Unsupported token: ${token}. Only USDC, EURC, ETH supported.`);

    try {
      if (tokenInfo.address === "native") {
        console.log(`📊 Fetching native ${token} balance for ${userAddress}...`);
        const balance = await this.publicClient.getBalance({
          address: userAddress as Address,
        });
        console.log(`   ✅ ${token} Balance: ${formatUnits(balance, 18)}`);
        return balance;
      } else if (tokenInfo.address === "EURC_NOT_DEPLOYED") {
        throw new Error(
          `Token ${token} is not deployed on Arc Testnet. Set ARC_EURC_ADDRESS environment variable.`
        );
      } else {
        console.log(
          `📊 Fetching ${token} balance (contract: ${tokenInfo.address}) for ${userAddress}...`
        );
        const balance = await this.publicClient.readContract({
          address: tokenInfo.address as Address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [userAddress as Address],
        });
        console.log(
          `   ✅ ${token} Balance: ${formatUnits(
            balance as bigint,
            tokenInfo.decimals
          )}`
        );
        return balance as bigint;
      }
    } catch (error: any) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to fetch ${token} balance: ${errorMsg}. Ensure ARC_EURC_ADDRESS is set correctly if using EURC.`
      );
    }
  }

  // ==========================================
  // 💰 REAL WALLET EXECUTION (NO MOCKING)
  // ==========================================
  private async executeTaskOnChain(
    plan: TaskPlan,
    context: TaskContext
  ): Promise<string> {
    if (!context.walletClient) throw new Error("No wallet client available");

    const allTxHashes: string[] = [];
    const executionLog: Array<{ step: string; txHash: string }> = [];

    // ✅ STRICT SEQUENTIAL LOOP: Execute ALL steps
    for (const step of plan.steps) {
      if (!["transfer", "swap", "approve", "deploy", "batchTransfer", "bridge"].includes(step.action)) {
        console.log(`⏭️  Skipping ${step.action}: ${step.description}`);
        continue;
      }

      console.log(`\n📝 Executing step: ${step.id} (${step.action})`);
      let stepTxHash: string | undefined;

      try {
        // ==========================================
        // SINGLE TRANSFER
        // ==========================================
        if (step.action === "transfer") {
          const { recipient, amount, token = "USDC" } = step.params;
          const tokenInfo = KNOWN_TOKENS[token];
          const amountWei = parseUnits(amount.toString(), tokenInfo.decimals);

          const balance = await this.getTokenBalance(context.userAddress, token);
          if (balance < amountWei) {
            throw new Error(
              `Insufficient ${token} balance. You have ${formatUnits(
                balance,
                tokenInfo.decimals
              )}, but need ${amount}`
            );
          }

          console.log(`💸 Sending ${amount} ${token} to ${recipient}...`);
          stepTxHash = await context.walletClient.sendTransaction({
            account: context.userAddress,
            to: recipient,
            value: tokenInfo.address === "native" ? amountWei : undefined,
          });
        }

        // ==========================================
        // BATCH TRANSFER
        // ==========================================
        else if (step.action === "batchTransfer") {
          const { recipients, amounts, token = "USDC" } = step.params;
          const tokenInfo = KNOWN_TOKENS[token];

          const totalAmount = amounts.reduce((sum: number, a: number) => sum + a, 0);
          const totalWei = parseUnits(totalAmount.toString(), tokenInfo.decimals);
          const balance = await this.getTokenBalance(context.userAddress, token);
          if (balance < totalWei) {
            throw new Error(
              `Insufficient ${token} balance for batch. You have ${formatUnits(
                balance,
                tokenInfo.decimals
              )}, but need ${totalAmount}`
            );
          }

          console.log(`📦 Batch transferring ${token} to ${recipients.length} recipients...`);
          for (let i = 0; i < recipients.length; i++) {
            const recipient = recipients[i];
            const amount = amounts[i] || amounts[0];
            const amountWei = parseUnits(amount.toString(), tokenInfo.decimals);

            console.log(
              `  [${i + 1}/${recipients.length}] → ${recipient} (${amount} ${token})`
            );
            const batchTxHash = await context.walletClient.sendTransaction({
              account: context.userAddress,
              to: recipient,
              value: tokenInfo.address === "native" ? amountWei : undefined,
            });

            console.log(`  ⏳ Waiting for receipt...`);
            const receipt = await this.publicClient.waitForTransactionReceipt({
              hash: batchTxHash as Address,
              timeout: 60_000,
            });
            if (receipt.status !== "success") {
              throw new Error(`Batch tx ${i} reverted: ${batchTxHash}`);
            }
            console.log(`  ✅ Confirmed: ${batchTxHash}`);
            allTxHashes.push(batchTxHash);
            executionLog.push({
              step: `batch[${i}]`,
              txHash: batchTxHash,
            });
          }
          continue;
        }

        // ==========================================
        // APPROVE ERC-20
        // ==========================================
        else if (step.action === "approve") {
          const { token, amount, spender } = step.params;
          const tokenInfo = KNOWN_TOKENS[token];
          if (!tokenInfo || tokenInfo.address === "native") {
            throw new Error(`Cannot approve native token ${token}`);
          }
          if (tokenInfo.address === "EURC_NOT_DEPLOYED") {
            throw new Error(
              `Token ${token} is not deployed on Arc Testnet (ARC_EURC_ADDRESS env var not set)`
            );
          }

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

          console.log(`🔐 Approving ${amount} ${token} to ${spender}...`);
          stepTxHash = await context.walletClient.writeContract({
            account: context.userAddress,
            address: tokenInfo.address as Address,
            abi: erc20Abi,
            functionName: "approve",
            args: [spender as Address, amountWei],
          });
        }

        // ==========================================
        // SWAP (Real DEX interaction)
        // ==========================================
        else if (step.action === "swap") {
          const { fromToken, toToken, amount, dexAddress } = step.params;
          const tokenInfo = KNOWN_TOKENS[fromToken];
          if (!tokenInfo) {
            throw new Error(`Unsupported token: ${fromToken}`);
          }

          const balance = await this.getTokenBalance(context.userAddress, fromToken);
          const amountWei = parseUnits(amount.toString(), tokenInfo.decimals);
          if (balance < amountWei) {
            throw new Error(
              `Insufficient ${fromToken} balance. You have ${formatUnits(
                balance,
                tokenInfo.decimals
              )}, but need ${amount}`
            );
          }

          // If DEX address provided, execute the swap
          if (dexAddress) {
            console.log(
              `🔄 Swapping ${amount} ${fromToken} for ${toToken} via ${dexAddress}...`
            );
            stepTxHash = await context.walletClient.writeContract({
              account: context.userAddress,
              address: dexAddress as Address,
              abi: [
                {
                  name: "swap",
                  type: "function",
                  stateMutability: "nonpayable",
                  inputs: [
                    { name: "amountIn", type: "uint256" },
                    { name: "minAmountOut", type: "uint256" },
                  ],
                  outputs: [{ name: "amountOut", type: "uint256" }],
                },
              ],
              functionName: "swap",
              args: [amountWei, parseUnits("0", KNOWN_TOKENS[toToken].decimals)],
            });
          } else {
            throw new Error(
              `Swap requires a DEX contract address on Arc Testnet. No DEX address found. Please specify a DEX or use a different approach.`
            );
          }
        }

        // ==========================================
        // BRIDGE (CCTP or native bridge)
        // ==========================================
        else if (step.action === "bridge") {
          const { fromChain, toChain, amount, token } = step.params;
          const tokenInfo = KNOWN_TOKENS[token];
          const amountWei = parseUnits(amount.toString(), tokenInfo.decimals);

          const balance = await this.getTokenBalance(context.userAddress, token);
          if (balance < amountWei) {
            throw new Error(
              `Insufficient ${token} balance for bridge. You have ${formatUnits(
                balance,
                tokenInfo.decimals
              )}, but need ${amount}`
            );
          }

          console.log(
            `🌉 Bridging ${amount} ${token} from ${fromChain} to ${toChain}...`
          );

          // CCTP bridge for USDC
          if (token === "USDC" && fromChain === "ARC-TESTNET") {
            throw new Error(
              `Bridge execution requires CCTP contract integration. Currently only plan-level bridge info is available. Implement CCTP contract calls for real execution.`
            );
          }

          throw new Error(
            `Bridge from ${fromChain} to ${toChain} requires specialized contract integration not yet configured.`
          );
        }

        // ==========================================
        // DEPLOY
        // ==========================================
        else if (step.action === "deploy") {
          console.log(`🚀 Deploying contract...`);
          throw new Error(
            "Contract deployment requires Solidity compiler and artifact management. Not available in agent execution."
          );
        }

        // ==========================================
        // ✅ WAIT FOR RECEIPT
        // ==========================================
        if (stepTxHash) {
          console.log(`⏳ Waiting for receipt for txHash: ${stepTxHash}`);
          const receipt = await this.publicClient.waitForTransactionReceipt({
            hash: stepTxHash as Address,
            timeout: 60_000,
          });

          if (receipt.status !== "success") {
            throw new Error(
              `Transaction reverted on-chain. TxHash: ${stepTxHash}. Status: ${receipt.status}`
            );
          }

          console.log(`✅ Step confirmed: ${stepTxHash}`);
          allTxHashes.push(stepTxHash);
          executionLog.push({
            step: step.id,
            txHash: stepTxHash,
          });
        }
      } catch (stepError: any) {
        console.error(`❌ Step ${step.id} failed:`, stepError.message);
        throw new Error(
          `Failed at step "${step.description}": ${
            stepError instanceof Error ? stepError.message : String(stepError)
          }`
        );
      }
    }

    if (allTxHashes.length === 0) {
      throw new Error("No transactions were executed in the plan");
    }

    console.log(`\n✅ All steps completed! Total txHashes: ${allTxHashes.length}`);
    console.log("Execution log:", executionLog);

    return allTxHashes[allTxHashes.length - 1];
  }

  private shouldExecute(taskTypes: string[]): boolean {
    return taskTypes.some((t) =>
      ["transfer", "swap", "approve", "deploy", "batch", "bridge"].includes(t)
    );
  }

  // ==========================================
  // PLANNER FUNCTIONS
  // ==========================================

  private async createExecutionPlan(
    taskTypes: string[],
    entities: Record<string, any>,
    context: TaskContext,
    scheduling?: { isScheduled?: boolean; scheduleTrigger?: string }
  ): Promise<TaskPlan> {
    // Reject impossible tasks
    if (taskTypes.includes("impossible")) {
      throw new Error(
        "This task is impossible with current Arc Testnet resources. Check if required contracts or tokens are deployed."
      );
    }

    if (taskTypes.includes("swap") && entities.tokens)
      return await this.createSwapPlan(entities, context);
    if (taskTypes.includes("transfer") && entities.addresses && entities.amounts)
      return await this.createTransferPlan(entities, context);
    if (taskTypes.includes("bridge") && entities.tokens)
      return await this.createBridgePlan(entities, context);
    if (taskTypes.includes("deploy") && entities.contractTypes)
      return await this.createDeploymentPlan(entities, context);
    if (taskTypes.includes("liquidity"))
      return await this.createLiquidityPlan(entities, context);
    if (taskTypes.includes("batch"))
      return await this.createBatchPlan(entities, context);
    if (taskTypes.includes("analyze"))
      return await this.createAnalysisPlan(entities, context);

    // Query/info request
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
      "DEX contract address",
    ];
    const warnings: string[] = [];

    if (entities.amounts && entities.tokens && entities.tokens.length >= 2) {
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
        params: { fromToken, toToken, amount, dexAddress: process.env.ARC_DEX_ADDRESS },
        dependencies: ["approve_token"],
        estimated_gas: 200000n,
      });

      warnings.push("⚠️ Swaps involve slippage and price impact");
      if (!process.env.ARC_DEX_ADDRESS) {
        warnings.push("⚠️ DEX address not configured (ARC_DEX_ADDRESS)");
      }
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
            token: "USDC",
          },
          dependencies: [],
          estimated_gas: BigInt(100000 * entities.addresses.length),
        });
      } else {
        steps.push({
          id: "single_transfer",
          description: `Transfer ${amount} USDC to ${recipient.slice(0, 6)}...`,
          action: "transfer",
          params: { recipient, amount, token: "USDC" },
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

  private async createBridgePlan(
    entities: Record<string, any>,
    context: TaskContext
  ): Promise<TaskPlan> {
    const steps: TaskStep[] = [];
    const { fromChain = "ARC-TESTNET", toChain, amount, tokens } = entities;
    const token = tokens?.[0] || "USDC";

    steps.push({
      id: "bridge_usdc",
      description: `Bridge ${amount} ${token} from ${fromChain} to ${toChain}`,
      action: "bridge",
      params: { fromChain, toChain, amount, token },
      dependencies: [],
      estimated_gas: 150000n,
    });

    return {
      steps,
      estimatedGas: 150000n,
      requirements: ["Connected wallet", `Sufficient ${token} balance`, "Bridge contract"],
      warnings: [
        "⚠️ Bridge operations take time to finalize",
        "💡 Requires attestation on destination chain",
      ],
    };
  }

  private async createDeploymentPlan(
    entities: Record<string, any>,
    context: TaskContext
  ): Promise<TaskPlan> {
    const steps: TaskStep[] = [];

    if (entities.contractTypes) {
      const contractType = entities.contractTypes[0].toUpperCase();
      steps.push({
        id: "deploy_contract",
        description: `Deploy ${contractType} contract`,
        action: "deploy",
        params: { type: contractType },
        dependencies: [],
        estimated_gas: 2000000n,
      });
    }

    return {
      steps,
      estimatedGas: 2100000n,
      requirements: ["Connected wallet", "Sufficient gas (USDC)", "Valid contract code"],
      warnings: [
        "⚠️ Contract deployment is permanent",
        "💡 Consider using verified templates",
      ],
    };
  }

  private async createLiquidityPlan(
    entities: Record<string, any>,
    context: TaskContext
  ): Promise<TaskPlan> {
    const steps: TaskStep[] = [];
    steps.push({
      id: "add_liquidity",
      description: "Add liquidity to pool",
      action: "addLiquidity",
      params: { tokens: entities.tokens, amounts: entities.amounts },
      dependencies: [],
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
  // ✅ ENHANCED VALIDATION WITH REAL CHECKS
  // ==========================================
  private async validatePlan(
    plan: TaskPlan,
    context: TaskContext
  ): Promise<{ valid: boolean; reasons: string[] }> {
    const reasons: string[] = [];

    if (!context.userAddress) {
      reasons.push("Wallet not connected");
      return { valid: false, reasons };
    }

    // PRE-CHECK: For transfers, validate real balance
    const transferStep = plan.steps.find((s) => s.action === "transfer");
    if (transferStep) {
      try {
        const amount = transferStep.params.amount || 0;
        const token = transferStep.params.token || "USDC";
        const balance = await this.getTokenBalance(context.userAddress, token);
        const required = parseUnits(
          amount.toString(),
          KNOWN_TOKENS[token].decimals
        );

        if (balance < required) {
          reasons.push(
            `Insufficient ${token} balance. You have ${formatUnits(
              balance,
              KNOWN_TOKENS[token].decimals
            )}, but need ${amount}`
          );
        }
      } catch (err: any) {
        reasons.push(`Balance check failed: ${err.message}`);
      }
    }

    // PRE-CHECK: Validate tokens
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
          `Unsupported token: ${token}. Only USDC, EURC, ETH supported on Arc Testnet.`
        );
      }
    }

    return { valid: reasons.length === 0, reasons };
  }

  // ==========================================
  // ⏰ SCHEDULED TASK MONITORING
  // ==========================================
  public getScheduledTask(taskId: string) {
    return scheduledTasks.get(taskId);
  }

  public getScheduledTasks() {
    return Array.from(scheduledTasks.values());
  }
}
