import { NextRequest } from "next/server";
import { google } from "googleapis";
import { SCOPES } from "@/lib/google";
import { redirect } from "next/navigation";

export async function GET(req: NextRequest) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return Response.json(
      { error: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set in .env.local" },
      { status: 400 }
    );
  }

  const proto = req.headers.get("x-forwarded-proto") || "http";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3001";
  const redirectUri = `${proto}://${host}/api/auth/google/callback`;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  return redirect(url);
}
