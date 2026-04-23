import NextAuth from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { authConfig } from "./auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    Credentials({
      name: "Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        try {
          const user = await prisma.dashboardUser.findUnique({
            where: { email: credentials.email as string },
          });
          if (!user?.password_hash) return null;
          const valid = await bcrypt.compare(credentials.password as string, user.password_hash);
          if (!valid) return null;
          return { id: user.id.toString(), email: user.email, name: user.name ?? undefined, role: user.role };
        } catch { return null; }
      },
    }),
    Nodemailer({
      server: {
        host: process.env.EMAIL_SERVER_HOST,
        port: Number(process.env.EMAIL_SERVER_PORT ?? 587),
        auth: { user: process.env.EMAIL_SERVER_USER, pass: process.env.EMAIL_SERVER_PASSWORD },
      },
      from: process.env.EMAIL_FROM,
    }),
    ...(process.env.AUTH_GOOGLE_ID
      ? [Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET! })]
      : []),
  ],
});