import { handleHealth } from "../../../lib/ai/health";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return handleHealth();
}
