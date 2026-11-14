import { handlePlus } from "../../../lib/limits/plus";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handlePlus(request);
}

export async function GET(request: Request): Promise<Response> {
  return handlePlus(request);
}
