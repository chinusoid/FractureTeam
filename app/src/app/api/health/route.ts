import { handleHealth } from "../../../lib/ai/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return handleHealth();
}
