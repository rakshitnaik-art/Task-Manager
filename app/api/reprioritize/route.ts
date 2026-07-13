import { prisma } from "@/lib/db";
import { reprioritizeTasks } from "@/lib/claude";

export async function POST() {
  const tasks = await prisma.task.findMany({
    where: { status: "open" },
    select: { id: true, priority: true, deadline: true, createdAt: true },
  });

  const updates = reprioritizeTasks(tasks);
  let changed = 0;

  await Promise.all(
    updates
      .filter(u => u.newPriority !== tasks.find(t => t.id === u.id)?.priority)
      .map(async u => {
        changed++;
        return prisma.task.update({ where: { id: u.id }, data: { priority: u.newPriority } });
      })
  );

  return Response.json({ ok: true, changed });
}
