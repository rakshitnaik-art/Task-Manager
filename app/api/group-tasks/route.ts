import { prisma } from "@/lib/db";
import { groupTasksByProject } from "@/lib/claude";

export async function POST() {
  // Only group tasks that haven't been manually labelled yet
  const tasks = await prisma.task.findMany({
    where: { status: "open", projectLabel: null },
    select: { id: true, title: true, description: true },
  });

  if (tasks.length === 0) return Response.json({ ok: true, grouped: 0 });

  const groupings = await groupTasksByProject(tasks);

  let grouped = 0;
  for (const { id, projectLabel } of groupings) {
    if (projectLabel) {
      await prisma.task.update({ where: { id }, data: { projectLabel } });
      grouped++;
    }
  }

  return Response.json({ ok: true, grouped });
}
