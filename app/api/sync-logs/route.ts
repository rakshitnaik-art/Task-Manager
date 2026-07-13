import { prisma } from "@/lib/db";

export async function GET() {
  const logs = await prisma.syncLog.findMany({
    orderBy: { syncedAt: "desc" },
    take: 50,
  });
  return Response.json(logs);
}

export async function DELETE() {
  await prisma.syncLog.deleteMany({});
  return Response.json({ ok: true });
}
