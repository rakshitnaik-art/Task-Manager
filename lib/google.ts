import { google } from "googleapis";
import { prisma } from "./db";
import { getSettings } from "./settings";

function getGoogleClientId(): string | undefined {
  return process.env.GOOGLE_CLIENT_ID || getSettings().googleClientId || undefined;
}

function getGoogleClientSecret(): string | undefined {
  return process.env.GOOGLE_CLIENT_SECRET || getSettings().googleClientSecret || undefined;
}

function getGoogleRedirectUri(): string {
  return (
    process.env.GOOGLE_REDIRECT_URI ||
    getSettings().googleRedirectUri ||
    "http://localhost:3001/api/auth/google/callback"
  );
}

function decodeBase64Url(data: string): string {
  try {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

function extractTextFromPayload(payload: unknown): string {
  const p = payload as { mimeType?: string; body?: { data?: string }; parts?: unknown[] };
  if (!p) return '';
  if (p.body?.data) {
    const text = decodeBase64Url(p.body.data);
    if (p.mimeType === 'text/plain') return text;
    if (p.mimeType === 'text/html') return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (p.parts) {
    const plain = p.parts.find((x: unknown) => (x as { mimeType?: string }).mimeType === 'text/plain');
    if (plain) return extractTextFromPayload(plain);
    const html = p.parts.find((x: unknown) => (x as { mimeType?: string }).mimeType === 'text/html');
    if (html) return extractTextFromPayload(html);
    for (const part of p.parts) {
      const text = extractTextFromPayload(part);
      if (text) return text;
    }
  }
  return '';
}

export const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
];

export function getOAuthClient() {
  return new google.auth.OAuth2(
    getGoogleClientId(),
    getGoogleClientSecret(),
    getGoogleRedirectUri()
  );
}

export function getAuthUrl() {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function getAuthenticatedClient() {
  const token = await prisma.oAuthToken.findUnique({ where: { provider: "google" } });
  if (!token) return null;

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: token.accessToken,
    refresh_token: token.refreshToken || undefined,
    expiry_date: token.expiresAt?.getTime(),
  });

  // Save refreshed tokens back to DB whenever Google issues new ones
  oauth2Client.on("tokens", async (tokens) => {
    await prisma.oAuthToken.update({
      where: { provider: "google" },
      data: {
        accessToken: tokens.access_token!,
        ...(tokens.refresh_token && { refreshToken: tokens.refresh_token }),
        ...(tokens.expiry_date && { expiresAt: new Date(tokens.expiry_date) }),
      },
    });
  });

  // Proactively refresh if expired or expiring within 5 minutes
  const expiresAt = token.expiresAt?.getTime() ?? 0;
  if (token.refreshToken && expiresAt < Date.now() + 5 * 60 * 1000) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);
      await prisma.oAuthToken.update({
        where: { provider: "google" },
        data: {
          accessToken: credentials.access_token!,
          ...(credentials.expiry_date && { expiresAt: new Date(credentials.expiry_date) }),
        },
      });
    } catch {
      // refresh failed — will retry on next API call
    }
  }

  return oauth2Client;
}

export async function fetchRecentEmailThreads(since?: Date, maxThreads = 60) {
  const auth = await getAuthenticatedClient();
  if (!auth) return [];

  const gmail = google.gmail({ version: 'v1', auth });
  // First sync: 60 days back. Subsequent syncs: only since last sync.
  const sinceDate = since || new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const query = `after:${Math.floor(sinceDate.getTime() / 1000)} -category:promotions -category:social -subject:FTP -subject:ftp -subject:FTP_IMPORT -subject:"cron job" -subject:"connection failure" -subject:"import alert" -subject:"pre-reminder" -subject:"copilot error" -subject:"cluster" (-category:updates OR from:slack.com)`;

  const [profileRes, listRes] = await Promise.all([
    gmail.users.getProfile({ userId: 'me' }),
    gmail.users.threads.list({ userId: 'me', q: query, maxResults: maxThreads }),
  ]);

  const myEmail = profileRes.data.emailAddress?.toLowerCase() || '';
  const threads = listRes.data.threads || [];
  const results = [];

  const batchSize = 5;
  for (let i = 0; i < threads.length; i += batchSize) {
    const batch = threads.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(t => gmail.users.threads.get({ userId: 'me', id: t.id!, format: 'full' }))
    );

    for (const res of batchResults) {
      if (res.status !== 'fulfilled') continue;
      const thread = res.value.data;
      const messages = thread.messages || [];
      if (messages.length === 0) continue;

      const firstMsg = messages[0];
      const headers = firstMsg.payload?.headers || [];
      const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
      const from = headers.find(h => h.name === 'From')?.value || '';
      const date = headers.find(h => h.name === 'Date')?.value || '';

      const lastMsg = messages[messages.length - 1];
      const lastHeaders = lastMsg.payload?.headers || [];
      const lastFrom = lastHeaders.find(h => h.name === 'From')?.value?.toLowerCase() || '';
      const lastDate = lastHeaders.find(h => h.name === 'Date')?.value || '';
      const sentByMe = !!myEmail && lastFrom.includes(myEmail);
      const daysSinceLast = lastDate ? (Date.now() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24) : 0;
      const needsFollowUp = sentByMe && daysSinceLast >= 3;

      const toHeader = headers.find(h => h.name === 'To')?.value || '';
      const ccHeader = headers.find(h => h.name === 'Cc')?.value || '';
      const isCC = !!myEmail && !toHeader.toLowerCase().includes(myEmail) && (ccHeader.toLowerCase().includes(myEmail) || ccHeader.length > 0);

      let combinedBody = '';
      for (const msg of messages) {
        const body = extractTextFromPayload(msg.payload).slice(0, 600);
        if (body) combinedBody += body + '\n---\n';
        if (combinedBody.length > 2500) break;
      }
      const bodyLower = combinedBody.toLowerCase();
      // Detect if the user is mentioned by their first name (from settings) or by email local-part
      const settings = getSettings();
      const nameToken = (settings.userName || '').split(/\s+/)[0]?.toLowerCase() || '';
      const emailLocalPart = (settings.userEmail || myEmail).split('@')[0]?.toLowerCase() || '';
      const mentionedInBody = (!!nameToken && bodyLower.includes(nameToken)) ||
        (!!emailLocalPart && bodyLower.includes(`+${emailLocalPart}`));

      results.push({
        id: thread.id!,
        subject,
        from,
        date,
        snippet: firstMsg.snippet || '',
        body: combinedBody.slice(0, 2500).trim(),
        messageCount: messages.length,
        needsFollowUp,
        lastSender: lastFrom,
        daysSinceLastMsg: Math.floor(daysSinceLast),
        isCC,
        mentionedInBody,
      });
    }
  }

  return results;
}

export async function fetchUpcomingEvents(days = 7) {
  const auth = await getAuthenticatedClient();
  if (!auth) return [];

  const calendar = google.calendar({ version: "v3", auth });
  const now = new Date();
  const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: now.toISOString(),
    timeMax: until.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 50,
  });

  const items = res.data.items || [];

  // Count how many times each recurring event ID appears in the 7-day window
  // If the same recurring event appears 4+ times it's a daily standup/sync — skip it
  const recurringCount: Record<string, number> = {};
  for (const e of items) {
    if (e.recurringEventId) {
      recurringCount[e.recurringEventId] = (recurringCount[e.recurringEventId] || 0) + 1;
    }
  }

  return items
    .filter((e) => {
      if (e.recurringEventId && recurringCount[e.recurringEventId] >= 4) return false;
      // Skip events the user has declined
      const myAttendance = e.attendees?.find(a => a.self === true);
      if (myAttendance?.responseStatus === "declined") return false;
      return true;
    })
    .map((e) => ({
      id: e.id!,
      title: e.summary || "(no title)",
      start: e.start?.dateTime || e.start?.date || "",
      end: e.end?.dateTime || e.end?.date || "",
      description: e.description || "",
      attendees: (e.attendees || []).map((a) => a.email || ""),
      isOrganizer: e.organizer?.self === true,
      hasActionItems: /[•\-\*]|\bcan you\b|\bplease\b|\baction item\b|\bnext step\b|\btodo\b|\bto-do\b|\bfollow.?up\b/i.test(e.description || ""),
    }));
}


export async function fetchRecentDocs() {
  const auth = await getAuthenticatedClient();
  if (!auth) return [];

  const drive = google.drive({ version: "v3", auth });
  const sheets = google.sheets({ version: "v4", auth });
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const res = await drive.files.list({
    q: `(mimeType='application/vnd.google-apps.document' or mimeType='application/vnd.google-apps.spreadsheet') and modifiedTime > '${since}'`,
    fields: "files(id, name, mimeType, modifiedTime, webViewLink)",
    orderBy: "modifiedTime desc",
    pageSize: 20,
  });

  const files = res.data.files || [];
  const results = [];

  for (const f of files) {
    let snippet = "";
    try {
      if (f.mimeType?.includes("spreadsheet")) {
        const sheetRes = await sheets.spreadsheets.values.get({
          spreadsheetId: f.id!,
          range: "A1:Z50",
        });
        const rows = sheetRes.data.values || [];
        snippet = rows.map((r) => r.join("\t")).join("\n").slice(0, 1500);
      }
    } catch {
      // skip if sheet can't be read
    }
    results.push({
      id: f.id!,
      name: f.name!,
      type: f.mimeType?.includes("spreadsheet") ? "sheet" : "doc",
      modifiedAt: f.modifiedTime!,
      url: f.webViewLink!,
      snippet,
    });
  }

  return results;
}
