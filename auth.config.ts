import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: { signIn: "/login", verifyRequest: "/login/verify" },
  session: { strategy: "jwt" },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const publicPaths = ["/login", "/api/auth", "/api/health", "/api/admin/bootstrap", "/api/inngest", "/api/cron", "/api/webhooks"];
      if (publicPaths.some((p) => nextUrl.pathname.startsWith(p))) return true;
      if (auth?.user) return true;
      const loginUrl = new URL("/login", nextUrl.origin);
      loginUrl.searchParams.set("callbackUrl", nextUrl.pathname);
      return Response.redirect(loginUrl);
    },
    async jwt({ token, user }) {
      if (user) { token.id = user.id; token.role = (user as { role?: string }).role; }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token) {
        session.user.id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;