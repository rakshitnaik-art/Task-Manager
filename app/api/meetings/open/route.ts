import { exec } from "child_process";

export async function POST() {
  exec("open /Applications/meetily.app");
  return Response.json({ ok: true });
}
