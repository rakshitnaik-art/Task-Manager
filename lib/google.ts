import { google } from "googleapis";
import { prisma } from "./db";

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
    process.env.GOOGLE_REDIRECT_URI || "http://localhost:3002/api/auth/google/callback"
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

  return oauth2Client;
}

export async function fetchRecentEmails(days = 60, maxResults = 200) {
  const auth = await getAuthenticatedClient();
  if (!auth) return [];

  const gmail = google.gmail({ version: "v1", auth });
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const query = `after:${Math.floor(since.getTime() / 1000)} -category:promotions -category:social -from:aira@capillarytech.com -from:dlf.in -subject:FTP -subject:ftp -subject:FTP_IMPORT -subject:"cron job" -subject:"connection failure" -subject:"import alert" -subject:"pre-reminder" -subject:aiRA -subject:aira -subject:"DLF" -subject:"copilot error" -subject:"cluster" -from:bhaskar.priyadarshi@capillarytech.com -from:harsh.deo@capillarytech.com (-category:updates OR from:slack.com)`;

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });

  const messages = listRes.data.messages || [];
  const results = [];

  // Fetch details in parallel batches of 10 to stay within rate limits
  const toFetch = messages.slice(0, 100);
  const batchSize = 10;

  for (let i = 0; i < toFetch.length; i += batchSize) {
    const batch = toFetch.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map((msg) =>
        gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "Date"],
        })
      )
    );

    for (const res of batchResults) {
      if (res.status !== "fulfilled") continue;
      const detail = res.value;
      const headers = detail.data.payload?.headers || [];
      const subject = headers.find((h) => h.name === "Subject")?.value || "(no subject)";
      const from = headers.find((h) => h.name === "From")?.value || "";
      const date = headers.find((h) => h.name === "Date")?.value || "";
      const snippet = detail.data.snippet || "";
      results.push({ id: detail.data.id!, subject, from, date, snippet });
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
