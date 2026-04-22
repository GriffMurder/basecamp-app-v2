import { auth } from "@/auth";
import { redirect } from "next/navigation";

export async function requireAuth() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return session;
}

export async function requireRole(roles: string[]) {
  const session = await requireAuth();
  const role = (session.user as { role?: string }).role ?? "";
  if (!roles.includes(role)) redirect("/dashboard");
  return session;
}

export async function requireAdmin() { return requireRole(["admin", "super_admin"]); }
export async function requireSuperAdmin() { return requireRole(["super_admin"]); }
