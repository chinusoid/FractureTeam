import type { AssistantErrorCode } from "../schemas/assistant";

const STATUS: Record<AssistantErrorCode, number> = {
  bad_request: 400,
  too_large: 413,
  forbidden_origin: 403,
  no_consent: 403,
  ai_disabled: 503,
  rate_limited: 429,
  budget_exhausted: 429,
  quota_unavailable: 503,
  upstream_error: 502,
  timeout: 504,
};

export class AssistantFailure extends Error {
  constructor(
    public code: AssistantErrorCode,
    message: string,
    public retryAfterSeconds?: number,
    /** Detail for server logs only (never contains user data). */
    public logDetail?: string,
  ) {
    super(message);
  }
}

export function errorResponse(
  code: AssistantErrorCode,
  message: string,
  retryAfterSeconds?: number,
  extraHeaders: Record<string, string> = {},
): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  };
  if (retryAfterSeconds !== undefined) headers["retry-after"] = String(retryAfterSeconds);
  const body = {
    error: {
      code,
      message,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    },
  };
  return new Response(JSON.stringify(body), { status: STATUS[code], headers });
}

export function statusFor(code: AssistantErrorCode): number {
  return STATUS[code];
}
