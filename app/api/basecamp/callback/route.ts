/**
 * GET /api/basecamp/callback
 * Basecamp OAuth 2.0 authorization callback.
 * Exchanges the code for tokens and stores them in BasecampPersonToken.
 * Mirrors app/deps.py OAuth flow.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { exchangeCode } from "@/lib/basecamp";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/dashboard?bc_error=${error}`, url.origin));
  }

  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  try {
    const tokens = await exchangeCode(code);

    // Store tokens keyed by the user's email (person_id)
    const user = await prisma.dashboardUser.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });

    if (user) {
      await prisma.basecampPersonToken.upsert({
        where: { person_id: String(user.id) },
        create: {
          person_id: String(user.id),
          token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: new Date(Date.now() + tokens.expires_in * 1000),
        },
        update: {
          token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: new Date(Date.now() + tokens.expires_in * 1000),
        },
      });
    }

    return NextResponse.redirect(new URL("/dashboard?bc_connected=1", url.origin));
  } catch (err) {
    console.error("[bc/callback] OAuth exchange failed:", err);
    return NextResponse.redirect(new URL("/dashboard?bc_error=exchange_failed", url.origin));
  }
}