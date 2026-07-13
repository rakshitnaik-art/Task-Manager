import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return Response.json({ error: "No code provided" }, { status: 400 });
  }

  const redirectUri = process.env.SLACK_REDIRECT_URI || "http://localhost:3000/api/auth/slack/callback";

  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID!,
      client_secret: process.env.SLACK_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const data = await res.json();

  if (!data.ok) {
    return Response.json({ error: data.error }, { status: 400 });
  }

  await prisma.oAuthToken.upsert({
    where: { provider: "slack" },
    create: {
      provider: "slack",
      accessToken: data.authed_user?.access_token || data.access_token,
      scope: data.scope || null,
    },
    update: {
      accessToken: data.authed_user?.access_token || data.access_token,
    },
  });

  return redirect("/settings?connected=slack");
}
