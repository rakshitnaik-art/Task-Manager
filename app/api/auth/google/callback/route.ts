import { NextRequest } from "next/server";
import { getOAuthClient } from "@/lib/google";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return Response.json({ error: "No code provided" }, { status: 400 });
  }

  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);

  await prisma.oAuthToken.upsert({
    where: { provider: "google" },
    create: {
      provider: "google",
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token || null,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scope: tokens.scope || null,
    },
    update: {
      accessToken: tokens.access_token!,
      ...(tokens.refresh_token && { refreshToken: tokens.refresh_token }),
      ...(tokens.expiry_date && { expiresAt: new Date(tokens.expiry_date) }),
    },
  });

  return redirect("/settings?connected=google");
}
