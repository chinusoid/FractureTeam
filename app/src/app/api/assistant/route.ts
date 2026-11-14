import { handleAssistant } from "../../../lib/ai/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return handleAssistant(request);
}

export async function GET(): Promise<Response> {
  return new Response(JSON.stringify({ error: { code: "bad_request", message: "Use POST." } }), {
    status: 405,
    headers: { "content-type": "application/json; charset=utf-8", allow: "POST" },
  });
}
