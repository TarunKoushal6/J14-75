export type LLMMessage = { role: "system" | "user" | "assistant"; content: string };

export type LLMOptions = {
  json_mode?: boolean;
  temperature?: number;
  max_tokens?: number;
};

const DEFAULT_BASE_URL = "https://api.freemodel.dev/v1";
const DEFAULT_MODEL = "gpt-5.5";

function getLLMConfig() {
  const apiKey =
    process.env.FREEMODEL_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.LLM_API_KEY ||
    "";
  const baseUrl = (
    process.env.FREEMODEL_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    process.env.LLM_BASE_URL ||
    DEFAULT_BASE_URL
  ).replace(/\/$/, "");
  const model =
    process.env.FREEMODEL_MODEL ||
    process.env.OPENAI_MODEL ||
    process.env.LLM_MODEL ||
    DEFAULT_MODEL;

  return { apiKey, baseUrl, model };
}

function fallbackIntent(message: string): string {
  const lower = message.toLowerCase();
  const addresses = [...message.matchAll(/0x[a-fA-F0-9]{40}/g)].map((m) => m[0]);
  const amountMatch = message.match(/(?:send|transfer|pay|bridge|swap)?\s*([0-9]+(?:\.[0-9]+)?)/i);
  const amounts = amountMatch ? [Number(amountMatch[1])] : [];

  if (lower.includes("bridge") || lower.includes("cctp")) {
    return JSON.stringify({
      taskTypes: ["bridge"],
      entities: { tokens: ["USDC"], amounts, toChain: lower.includes("base") ? "Base" : "Ethereum" },
      isScheduled: false,
    });
  }

  if (lower.includes("swap") || lower.includes("exchange")) {
    return JSON.stringify({
      taskTypes: ["swap"],
      entities: { tokenIn: "USDC", tokenOut: "EURC", amounts },
      isScheduled: false,
    });
  }

  if (lower.includes("send") || lower.includes("transfer") || lower.includes("pay")) {
    return JSON.stringify({
      taskTypes: ["transfer"],
      entities: { addresses, tokens: [lower.includes("eurc") ? "EURC" : "USDC"], amounts },
      isScheduled: false,
    });
  }

  if (lower.includes("balance") || lower.includes("history") || lower.includes("tx")) {
    return JSON.stringify({ taskTypes: ["query"], entities: {}, isScheduled: false });
  }

  return JSON.stringify({ taskTypes: ["query"], entities: {}, isScheduled: false });
}

export async function callLLM(messages: LLMMessage[], options: LLMOptions = {}): Promise<string> {
  const { apiKey, baseUrl, model } = getLLMConfig();
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  if (!apiKey) {
    console.warn("⚠️ FREEMODEL_API_KEY/OPENAI_API_KEY missing; using local fallback parser.");
    return options.json_mode ? fallbackIntent(lastUser) : "I can help with Arc Testnet USDC transfers, balances, CCTP bridging, and swaps. Configure FREEMODEL_API_KEY for GPT-5.5 responses.";
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.max_tokens ?? 1200,
  };

  if (options.json_mode) {
    body.response_format = { type: "json_object" };
  }

  try {
    const llmFetch = globalThis.fetch as unknown as (input: string, init?: RequestInit) => Promise<any>;
    const res = await llmFetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) {
      console.warn(`⚠️ GPT-5.5 chat/completions failed (${res.status}): ${text.slice(0, 300)}`);
      return options.json_mode ? fallbackIntent(lastUser) : "LLM provider failed, but Arc actions can still use local parsing for basic commands.";
    }

    const data = JSON.parse(text) as any;
    return data.choices?.[0]?.message?.content ?? data.output_text ?? "";
  } catch (err: any) {
    console.warn("⚠️ GPT-5.5 LLM call failed:", err?.message ?? err);
    return options.json_mode ? fallbackIntent(lastUser) : "LLM provider unavailable, but basic Arc commands still work with local parsing.";
  }
}
