import { WebClient } from "@slack/web-api";
import { prisma } from "./db";

const COMPLETION_EMOJIS = new Set([
  'white_check_mark', 'done2', 'donecheck', 'ack_', 'ack',
  'check', 'heavy_check_mark', 'done', 'completed', 'approved',
  'merged', 'shipit', 'rocket', 'green_circle', 'large_green_circle',
  'tada', '+1', 'thumbsup', 'ok', 'yes', 'suredot', 'skip-it',
  'no_worries', 'v', 'white-check-mark',
]);

async function getClient() {
  const token = await prisma.oAuthToken.findUnique({ where: { provider: "slack" } });
  if (!token) return null;
  return new WebClient(token.accessToken);
}

export async function fetchRecentSlackMessages(days = 7) {
  const client = await getClient();
  if (!client) return [];

  const oldest = String(Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000));
  const results: Array<{ channel: string; text: string; ts: string; user: string; userAlreadyActioned: boolean }> = [];

  try {
    const authTest = await client.auth.test();
    if (!authTest.ok) {
      console.error("Slack auth failed:", authTest.error);
      return [];
    }
    const myUserId = authTest.user_id || '';

    const channelsRes = await client.conversations.list({ types: "public_channel,private_channel,im", limit: 50 });
    const channels = (channelsRes.channels || []).filter((c) => c.is_member);
    console.log(`Slack: ${channels.length} channels found`);

    for (const ch of channels.slice(0, 10)) {
      try {
        const history = await client.conversations.history({
          channel: ch.id!,
          oldest,
          limit: 20,
        });

        for (const msg of history.messages || []) {
          if (msg.text && !msg.bot_id) {
            // Check if user already actioned this message via a completion reaction
            const reactions = (msg as { reactions?: Array<{ name: string; users: string[] }> }).reactions || [];
            const userAlreadyActioned = myUserId
              ? reactions.some(r => COMPLETION_EMOJIS.has(r.name) && r.users.includes(myUserId))
              : false;

            results.push({
              channel: ch.name || ch.id!,
              text: msg.text,
              ts: msg.ts || "",
              user: msg.user || "",
              userAlreadyActioned,
            });
          }
        }
      } catch {
        // skip channels we can't read
      }
    }
  } catch {
    // slack API error
  }

  return results;
}

export function getSlackAuthUrl() {
  const clientId = process.env.SLACK_CLIENT_ID;
  const redirectUri = process.env.SLACK_REDIRECT_URI || "http://localhost:3000/api/auth/slack/callback";
  const scopes = "channels:history,channels:read,groups:history,groups:read,im:history,im:read,users:read";
  return `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}`;
}

export async function sendSlackDM(text: string): Promise<boolean> {
  const client = await getClient();
  if (!client) return false;
  try {
    const auth = await client.auth.test();
    if (!auth.ok || !auth.user_id) return false;
    await client.chat.postMessage({ channel: auth.user_id, text });
    return true;
  } catch {
    return false;
  }
}
