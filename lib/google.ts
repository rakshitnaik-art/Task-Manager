import { google } from "googleapis";
import { prisma } from "./db";

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

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
];

export function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || "http://localhost:3001/api/auth/google/callback"
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

export async function fetchRecentEmailThreads(days = 60, maxThreads = 60) {
  const auth = await getAuthenticatedClient();
  if (!auth) return [];

  const gmail = google.gmail({ version: 'v1', auth });
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const query = `after:${Math.floor(since.getTime() / 1000)} -category:promotions -category:social -from:aira@capillarytech.com -from:dlf.in -subject:FTP -subject:ftp -subject:FTP_IMPORT -subject:"cron job" -subject:"connection failure" -subject:"import alert" -subject:"pre-reminder" -subject:aiRA -subject:aira -subject:"DLF" -subject:"copilot error" -subject:"cluster" -from:bhaskar.priyadarshi@capillarytech.com -from:harsh.deo@capillarytech.com (-category:updates OR from:slack.com)`;

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

      let combinedBody = '';
      for (const msg of messages) {
        const body = extractTextFromPayload(msg.payload).slice(0, 600);
        if (body) combinedBody += body + '\n---\n';
        if (combinedBody.length > 2500) break;
      }

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
    .filter((e) => !e.recurringEventId || recurringCount[e.recurringEventId] < 4)
    .map((e) => ({
      id: e.id!,
      title: e.summary || "(no title)",
      start: e.start?.dateTime || e.start?.date || "",
      end: e.end?.dateTime || e.end?.date || "",
      description: e.description || "",
      attendees: (e.attendees || []).map((a) => a.email || ""),
    }));
}

const PINNED_SHEETS = [
  {
    id: "1x2SBFkEb5TsCa334DLDMKm-kn0V9S5ZAmwzU2EqMv8A",
    gid: 682521224,
    label: "My Personal Task Sheet",
  },
  {
    id: "1RRlFMLk3jDgMM9VCMortqE_OZ0BqO2nDv4XTyLKHomI",
    gid: 918907142,
    label: "Team Product Roadmap",
  },
  {
    id: "1VaxsPzPHeJjO2pJrUT2YUlEpsDqFGe168FKrzjkEdjA",
    gid: 925585987,
    label: "PM Task Tracker (Bhaskar)",
  },
];

export async function fetchPinnedSheets() {
  const auth = await getAuthenticatedClient();
  if (!auth) return [];

  const sheetsClient = google.sheets({ version: "v4", auth });
  const results = [];

  for (const pinned of PINNED_SHEETS) {
    try {
      // Resolve gid → sheet tab name
      const meta = await sheetsClient.spreadsheets.get({ spreadsheetId: pinned.id });
      const tab = meta.data.sheets?.find((s) => s.properties?.sheetId === pinned.gid);
      const tabName = tab?.properties?.title;
      if (!tabName) continue;

      const range = `${tabName}!A1:Z300`;
      const dataRes = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: pinned.id,
        range,
      });

      const rows = dataRes.data.values || [];
      const snippet = rows.map((r) => r.join("\t")).join("\n").slice(0, 3000);

      results.push({
        id: pinned.id,
        name: pinned.label,
        type: "sheet",
        modifiedAt: new Date().toISOString(),
        url: `https://docs.google.com/spreadsheets/d/${pinned.id}/edit#gid=${pinned.gid}`,
        snippet,
      });
    } catch {
      // skip if sheet can't be accessed
    }
  }

  return results;
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
