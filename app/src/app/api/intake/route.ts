import { handleIntake } from "../../../lib/ai/intake";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return handleIntake(request);
}
