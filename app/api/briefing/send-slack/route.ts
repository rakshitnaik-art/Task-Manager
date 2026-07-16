import { NextRequest } from "next/server";
import { sendSlackDM } from "@/lib/slack";

export async function POST(req: NextRequest) {
  const { message } = await req.json();
  if (!message) return Response.json({ error: "message required" }, { status: 400 });
  const sent = await sendSlackDM(message);
  return Response.json({ sent });
}
