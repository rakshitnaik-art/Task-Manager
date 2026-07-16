import { getSettings } from "@/lib/settings";
import { prisma } from "@/lib/db";

export async function GET() {
  const settings = getSettings();

  let hasGoogle = false;
  try {
    const token = await prisma.oAuthToken.findUnique({ where: { provider: "google" } });
    hasGoogle = !!token;
  } catch {
    // OAuthToken table may not exist yet on a totally fresh DB
    hasGoogle = false;
  }

  return Response.json({
    complete: settings.setupComplete,
    userName: settings.userName,
    userEmail: settings.userEmail,
    hasAnthropicKey: (settings.anthropicKey || process.env.ANTHROPIC_API_KEY || "").length > 0,
    hasGoogle,
  });
}
