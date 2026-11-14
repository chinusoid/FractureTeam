/**
 * Provider for a self-hosted model behind an OpenAI-compatible Chat Completions endpoint
 * (llama.cpp `llama-server --jinja`, vLLM, SGLang, Ollama, LM Studio, NVIDIA NIM).
 *
 * It speaks the same internal Responses-style shape as openai.ts, so the tool loop, guards,
 * quotas and confirmation flow are identical whichever model answers.
 */
import { AssistantFailure } from "./errors";
import type { FunctionCallItem, InputItem, MessageItem, ModelProvider, OutputItem, ResponsesRequestBody, ResponsesResult } from "./openai";

export interface ChatProviderConfig {
  /** Base URL including /v1, e.g. https://example.trycloudflare.com/v1 */
  baseUrl: string;
  apiKey: string | null;
  model: string;
  /** Qwen-style thinking mode. Off by default: it is slow and our answers are short. */
  thinking: boolean;
}

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ResponsesFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters?: unknown;
}

export function toChatRequest(body: ResponsesRequestBody, cfg: ChatProviderConfig): Record<string, unknown> {
  const messages: ChatMessage[] = [{ role: "system", content: body.instructions }];
  for (const item of body.input) {
    const typed = item as { type?: string };
    if (typed.type === "function_call") {
      const fc = item as FunctionCallItem;
      const call: ChatToolCall = { id: fc.call_id, type: "function", function: { name: fc.name, arguments: fc.arguments || "{}" } };
      const last = messages[messages.length - 1];
      if (last && last.role === "assistant" && last.tool_calls) last.tool_calls.push(call);
      else messages.push({ role: "assistant", content: null, tool_calls: [call] });
    } else if (typed.type === "function_call_output") {
      const out = item as { call_id: string; output: string };
      messages.push({ role: "tool", tool_call_id: out.call_id, content: out.output });
    } else if (typed.type === "message") {
      const text = ((item as MessageItem).content ?? [])
        .map((p) => (p.type === "output_text" ? p.text : ""))
        .join("")
        .trim();
      if (text) messages.push({ role: "assistant", content: text });
    } else if (typed.type === undefined && "role" in (item as object)) {
      const m = item as { role: string; content: string };
      if (m.role === "assistant") messages.push({ role: "assistant", content: m.content });
      else messages.push({ role: m.role === "user" ? "user" : "system", content: m.content });
    }
    // Other item types (e.g. OpenAI reasoning items after a fallback) carry nothing a local model can use.
  }

  const request: Record<string, unknown> = {
    model: cfg.model,
    messages,
    max_tokens: body.max_output_tokens,
    temperature: 0,
    stream: false,
    chat_template_kwargs: { enable_thinking: cfg.thinking },
  };
  const tools = (body.tools ?? []) as ResponsesFunctionTool[];
  if (tools.length && body.tool_choice !== "none") {
    request.tools = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description ?? "", parameters: t.parameters ?? { type: "object", properties: {} } },
    }));
    request.tool_choice = body.tool_choice ?? "auto";
    request.parallel_tool_calls = false;
  }
  if (body.text?.format?.type === "json_schema") {
    request.response_format = {
      type: "json_schema",
      json_schema: { name: body.text.format.name, schema: body.text.format.schema, strict: true },
    };
  }
  return request;
}

let seq = 0;
function callId(): string {
  seq = (seq + 1) % 1_000_000;
  return `call_local_${Date.now().toString(36)}_${seq}`;
}

function coerce(value: string): unknown {
  const v = value.trim();
  if (v === "") return "";
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/**
 * Tool calls left inside the text when the server has no tool-call parser. Supports the Qwen XML form
 * (<tool_call><function=name><parameter=x>v</parameter></function></tool_call>) and JSON
 * (<tool_call>{"name": ..., "arguments": {...}}</tool_call>).
 */
export function extractTextToolCalls(text: string): { calls: { name: string; arguments: string }[]; rest: string } {
  const calls: { name: string; arguments: string }[] = [];
  const rest = text.replace(/<tool_call>([\s\S]*?)<\/tool_call>/g, (_, inner: string) => {
    const fn = /<function=([^>\s]+)>([\s\S]*?)<\/function>/.exec(inner);
    if (fn) {
      const args: Record<string, unknown> = {};
      const re = /<parameter=([^>\s]+)>\n?([\s\S]*?)\n?<\/parameter>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(fn[2]))) args[m[1]] = coerce(m[2]);
      calls.push({ name: fn[1], arguments: JSON.stringify(args) });
      return "";
    }
    try {
      const j = JSON.parse(inner.trim()) as { name?: string; arguments?: unknown; parameters?: unknown };
      if (typeof j.name === "string") {
        const a = j.arguments ?? j.parameters ?? {};
        calls.push({ name: j.name, arguments: typeof a === "string" ? a : JSON.stringify(a) });
        return "";
      }
    } catch {
      /* not a tool call */
    }
    return _;
  });
  return { calls, rest };
}

export function fromChatResponse(json: unknown): ResponsesResult {
  const r = (json ?? {}) as {
    choices?: { message?: { content?: unknown; tool_calls?: unknown }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = r.choices?.[0];
  const msg = choice?.message ?? {};
  let content =
    typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? (msg.content as { text?: string }[]).map((p) => p?.text ?? "").join("")
        : "";
  content = content.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*?<\/think>/, "");

  const output: OutputItem[] = [];
  const structured = Array.isArray(msg.tool_calls) ? (msg.tool_calls as Partial<ChatToolCall>[]) : [];
  for (const tc of structured) {
    const name = tc.function?.name;
    if (typeof name !== "string") continue;
    const args = tc.function?.arguments as unknown;
    output.push({
      type: "function_call",
      call_id: typeof tc.id === "string" && tc.id ? tc.id : callId(),
      name,
      arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
    } satisfies FunctionCallItem);
  }
  if (!structured.length && content.includes("<tool_call>")) {
    const { calls, rest } = extractTextToolCalls(content);
    for (const c of calls) output.push({ type: "function_call", call_id: callId(), name: c.name, arguments: c.arguments } satisfies FunctionCallItem);
    content = rest;
  }
  content = content.trim();
  if (content) {
    output.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: content }] } satisfies MessageItem);
  }
  const truncated = choice?.finish_reason === "length";
  return {
    status: truncated ? "incomplete" : "completed",
    output,
    usage: {
      inputTokens: Number(r.usage?.prompt_tokens ?? 0) || 0,
      outputTokens: Number(r.usage?.completion_tokens ?? 0) || 0,
    },
    incompleteReason: truncated ? "max_output_tokens" : null,
  };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function chatCompletionsProvider(cfg: ChatProviderConfig, fetchImpl: FetchLike = (i, init) => fetch(i, init)): ModelProvider {
  return async (body, signal) => {
    let res: Response;
    try {
      res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify(toChatRequest(body, cfg)),
        signal,
        cache: "no-store",
      });
    } catch (e) {
      if (signal.aborted) throw new AssistantFailure("timeout", "The assistant took too long to answer. Try again or use the form.", undefined, "local timeout");
      throw new AssistantFailure("upstream_error", "The assistant is unreachable right now. Use the form instead.", undefined, `local fetch failed: ${(e as Error).name}`);
    }
    if (!res.ok) {
      throw new AssistantFailure("upstream_error", "The assistant model could not answer. Use the form instead.", undefined, `local ${res.status}`);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new AssistantFailure("upstream_error", "The assistant model returned an unreadable answer.", undefined, "local bad json");
    }
    return fromChatResponse(json);
  };
}

export type { InputItem };
