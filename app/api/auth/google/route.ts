import { getAuthUrl } from "@/lib/google";
import { redirect } from "next/navigation";

export async function GET() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return Response.json(
      { error: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set in .env.local" },
      { status: 400 }
    );
  }
  const url = getAuthUrl();
  return redirect(url);
}
