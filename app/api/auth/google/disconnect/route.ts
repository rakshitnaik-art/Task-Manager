import { prisma } from "@/lib/db";

export async function POST() {
  await prisma.oAuthToken.deleteMany({ where: { provider: "google" } });
  return Response.json({ ok: true });
}
