import { NextRequest } from "next/server";
import { getSettings, saveSettings, TaskoraSettings } from "@/lib/settings";

// Return sanitized settings — never expose actual secret values, only whether they're set.
function sanitize(settings: TaskoraSettings) {
  return {
    setupComplete: settings.setupComplete,
    userName: settings.userName,
    userEmail: settings.userEmail,
    hasAnthropicKey: settings.anthropicKey.length > 0,
    hasGoogleClientId: settings.googleClientId.length > 0,
    hasGoogleClientSecret: settings.googleClientSecret.length > 0,
    googleRedirectUri: settings.googleRedirectUri,
    hasSlackClientId: settings.slackClientId.length > 0,
    hasSlackClientSecret: settings.slackClientSecret.length > 0,
    slackRedirectUri: settings.slackRedirectUri,
  };
}

export async function GET() {
  const settings = getSettings();
  return Response.json(sanitize(settings));
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<TaskoraSettings>;

  // Only allow the known settings keys
  const allowed: (keyof TaskoraSettings)[] = [
    "setupComplete",
    "userName",
    "userEmail",
    "anthropicKey",
    "googleClientId",
    "googleClientSecret",
    "googleRedirectUri",
    "slackClientId",
    "slackClientSecret",
    "slackRedirectUri",
  ];

  const patch: Partial<TaskoraSettings> = {};
  for (const key of allowed) {
    if (key in body && body[key] !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (patch as any)[key] = body[key];
    }
  }

  const saved = saveSettings(patch);

  // Update process env immediately so newly-set keys work without restart
  if (patch.anthropicKey) process.env.ANTHROPIC_API_KEY = patch.anthropicKey;
  if (patch.googleClientId) process.env.GOOGLE_CLIENT_ID = patch.googleClientId;
  if (patch.googleClientSecret) process.env.GOOGLE_CLIENT_SECRET = patch.googleClientSecret;
  if (patch.googleRedirectUri) process.env.GOOGLE_REDIRECT_URI = patch.googleRedirectUri;
  if (patch.slackClientId) process.env.SLACK_CLIENT_ID = patch.slackClientId;
  if (patch.slackClientSecret) process.env.SLACK_CLIENT_SECRET = patch.slackClientSecret;
  if (patch.slackRedirectUri) process.env.SLACK_REDIRECT_URI = patch.slackRedirectUri;

  return Response.json({ ok: true, settings: sanitize(saved) });
}
