/**
 * Thin client for the OpenAI Responses API (POST /v1/responses) using fetch.
 * Stateless: store:false, every call re-sends the conversation items.
 */
import type { ServerEnv } from "./env";
import { AssistantFailure } from "./errors";

export interface FunctionCallItem {
  type: "function_call";
  id?: string;
  call_id: string;
  name: string;
  arguments: string;
  status?: string;
}

export interface MessageItem {
  type: "message";
  id?: string;
  role: "assistant";
  status?: string;
  content: ({ type: "output_text"; text: string; annotations?: unknown[] } | { type: "refusal"; refusal: string })[];
}

export type OutputItem = FunctionCallItem | MessageItem | { type: string; [key: string]: unknown };

export type InputItem =
  | { role: "user" | "assistant" | "developer" | "system"; content: string }
  | { type: "function_call_output"; call_id: string; output: string }
  | OutputItem;

export interface ResponsesRequestBody {
  model: string;
  instructions: string;
  input: InputItem[];
  tools?: unknown[];
  tool_choice?: "auto" | "none" | "required";
  parallel_tool_calls?: boolean;
  text?: { format: { type: "json_schema"; name: string; schema: unknown; strict: boolean } };
  store: false;
  max_output_tokens: number;
  reasoning?: { effort: string };
  include?: string[];
}

export interface ResponsesResult {
  status: string;
  output: OutputItem[];
  usage: { inputTokens: number; outputTokens: number };
  incompleteReason: string | null;
}

/** Provider = something that answers a Responses API request. Real API, the mock, or a test script. */
export type ModelProvider = (body: ResponsesRequestBody, signal: AbortSignal) => Promise<ResponsesResult>;

export function baseRequest(env: ServerEnv, instructions: string, input: InputItem[]): ResponsesRequestBody {
  const body: ResponsesRequestBody = {
    model: env.model,
    instructions,
    input,
    store: false,
    max_output_tokens: env.maxOutputTokens,
  };
  if (env.reasoningEffort) {
    body.reasoning = { effort: env.reasoningEffort };
    body.include = ["reasoning.encrypted_content"];
  }
  return body;
}

export function parseResult(json: unknown): ResponsesResult {
  const r = (json ?? {}) as {
    status?: string;
    output?: unknown;
    usage?: { input_tokens?: number; output_tokens?: number };
    incomplete_details?: { reason?: string } | null;
  };
  return {
    status: typeof r.status === "string" ? r.status : "completed",
    output: Array.isArray(r.output) ? (r.output as OutputItem[]) : [],
    usage: {
      inputTokens: Number(r.usage?.input_tokens ?? 0) || 0,
      outputTokens: Number(r.usage?.output_tokens ?? 0) || 0,
    },
    incompleteReason: r.incomplete_details?.reason ?? null,
  };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function openAIProvider(env: ServerEnv, fetchImpl: FetchLike = (i, init) => fetch(i, init)): ModelProvider {
  return async (body, signal) => {
    if (!env.openaiApiKey) {
      throw new AssistantFailure("ai_disabled", "The assistant is not configured on this server.", undefined, "missing OPENAI_API_KEY");
    }
    let res: Response;
    try {
      res = await fetchImpl(`${env.openaiBaseUrl}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.openaiApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
        cache: "no-store",
      });
    } catch (e) {
      if (signal.aborted) throw new AssistantFailure("timeout", "The assistant took too long to answer. Try again or use the form.");
      throw new AssistantFailure("upstream_error", "The assistant is unreachable right now. Use the form instead.", undefined, `fetch failed: ${(e as Error).name}`);
    }
    if (!res.ok) {
      let detail = "";
      try {
        const err = (await res.json()) as { error?: { code?: string; type?: string; message?: string } };
        detail = `${err.error?.type ?? ""} ${err.error?.code ?? ""}`.trim();
        if (/model/i.test(err.error?.message ?? "") || err.error?.code === "model_not_found") detail += " model";
      } catch {
        /* ignore */
      }
      throw mapHttpError(res.status, detail, res.headers.get("retry-after"));
    }
    return parseResult(await res.json());
  };
}

export function mapHttpError(status: number, detail: string, retryAfter: string | null): AssistantFailure {
  if (status === 401) {
    return new AssistantFailure("upstream_error", "The AI service rejected the server's API key. Check OPENAI_API_KEY.", undefined, `openai 401 ${detail}`);
  }
  if (status === 404 || ((status === 400 || status === 403) && /model/.test(detail))) {
    return new AssistantFailure(
      "upstream_error",
      "The configured AI model is not available for this API key. Check OPENAI_MODEL.",
      undefined,
      `openai ${status} ${detail}`,
    );
  }
  if (status === 403) {
    return new AssistantFailure("upstream_error", "The AI service refused the request for this account.", undefined, `openai 403 ${detail}`);
  }
  if (status === 429) {
    const secs = Number(retryAfter);
    return new AssistantFailure(
      "upstream_error",
      "The AI provider is busy or out of quota. Try again shortly or use the form.",
      Number.isFinite(secs) && secs > 0 ? Math.ceil(secs) : undefined,
      `openai 429 ${detail}`,
    );
  }
  if (status >= 500) {
    return new AssistantFailure("upstream_error", "The AI service is having problems. Use the form instead.", undefined, `openai ${status}`);
  }
  return new AssistantFailure("upstream_error", "The AI service could not process this request.", undefined, `openai ${status} ${detail}`);
}

export function textOf(output: OutputItem[]): { text: string; refusal: string | null } {
  let text = "";
  let refusal: string | null = null;
  for (const item of output) {
    if (item.type !== "message") continue;
    for (const part of (item as MessageItem).content ?? []) {
      if (part.type === "output_text") text += part.text;
      else if (part.type === "refusal") refusal = part.refusal;
    }
  }
  return { text: text.trim(), refusal };
}

export function functionCalls(output: OutputItem[]): FunctionCallItem[] {
  return output.filter((i): i is FunctionCallItem => i.type === "function_call" && typeof (i as FunctionCallItem).name === "string");
}
