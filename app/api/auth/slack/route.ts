import { getSlackAuthUrl } from "@/lib/slack";
import { redirect } from "next/navigation";

export async function GET() {
  if (!process.env.SLACK_CLIENT_ID || !process.env.SLACK_CLIENT_SECRET) {
    return Response.json(
      { error: "SLACK_CLIENT_ID and SLACK_CLIENT_SECRET are not set in .env.local" },
      { status: 400 }
    );
  }
  return redirect(getSlackAuthUrl());
}
