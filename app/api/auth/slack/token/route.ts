import { prisma } from "@/lib/db";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const { token } = await req.json();
  if (!token || typeof token !== "string" || !token.startsWith("xox")) {
    return Response.json({ error: "Invalid token" }, { status: 400 });
  }

  await prisma.oAuthToken.upsert({
    where: { provider: "slack" },
    update: { accessToken: token },
    create: {
      provider: "slack",
      accessToken: token,
      scope: "channels:history,channels:read,groups:history,groups:read,im:history,im:read,users:read",
    },
  });

  return Response.json({ ok: true });
}
