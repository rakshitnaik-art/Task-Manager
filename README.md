# Focus Hub — PM Productivity Dashboard

Aggregates Gmail, Google Calendar, Docs/Sheets, Slack, and Granola meetings. Claude analyzes everything and surfaces your most important tasks for today and the week, ranked by priority, impact, and deadline.

## Setup (one-time)

### 1. Fill in `.env.local`

```
ANTHROPIC_API_KEY=       # console.anthropic.com
GOOGLE_CLIENT_ID=        # console.cloud.google.com → APIs & Services → Credentials
GOOGLE_CLIENT_SECRET=
SLACK_CLIENT_ID=         # api.slack.com/apps
SLACK_CLIENT_SECRET=
```

### 2. Google Cloud setup
- Go to console.cloud.google.com
- Enable: Gmail API, Google Calendar API, Google Drive API
- Create OAuth 2.0 credentials → Web Application
- Add authorized redirect URI: `http://localhost:3000/api/auth/google/callback`

### 3. Slack app setup
- Go to api.slack.com/apps → Create New App
- Add OAuth redirect URL: `http://localhost:3000/api/auth/slack/callback`
- Add user token scopes: `channels:history`, `channels:read`, `groups:history`, `groups:read`, `im:history`, `im:read`

### 4. Run

```bash
npm run dev
```

Open http://localhost:3000 → go to Settings → connect Google and Slack.

Then hit **Sync now** on the Today page.

## What it does

| View | What you see |
|------|-------------|
| **Today** | Critical + High priority tasks right now |
| **This Week** | All open tasks, filterable by source |
| **Calls** | Granola meetings, auto-mapped to tasks by Claude |
| **Settings** | Connect accounts, view sync status |

## Granola

Reads meeting notes directly from `~/Library/Application Support/Granola` — no API key needed. Just have Granola installed and recording.
