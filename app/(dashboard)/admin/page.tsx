import { requireAdmin } from "@/lib/auth";
import Link from "next/link";
import { Users, Building2, Mail, Clock, Settings } from "lucide-react";

export const dynamic = "force-dynamic";

const sections = [
  {
    href: "/admin/users",
    icon: Users,
    label: "User Management",
    description: "Create accounts, assign roles, approve pending users",
  },
  {
    href: "/admin/orgs",
    icon: Building2,
    label: "Organizations",
    description: "Manage multi-tenant organizations and their slugs",
  },
  {
    href: "/admin/email-routing",
    icon: Mail,
    label: "Email Routing",
    description: "Manage Cloudflare email forwarding destinations and rules",
  },
  {
    href: "/admin/clockify",
    icon: Clock,
    label: "Clockify Sync",
    description: "Monitor sync health, trigger incremental or full imports",
  },
];

export default async function AdminPage() {
  await requireAdmin();
  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-2">
        <Settings className="w-6 h-6 text-blue-500" />
        <h1 className="text-2xl font-bold text-gray-900">Admin</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {sections.map(({ href, icon: Icon, label, description }) => (
          <Link
            key={href}
            href={href}
            className="bg-white rounded-lg border shadow-sm p-5 hover:border-blue-400 hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3 mb-2">
              <Icon className="w-5 h-5 text-blue-500 group-hover:text-blue-600" />
              <h2 className="font-semibold text-gray-800 group-hover:text-blue-700">{label}</h2>
            </div>
            <p className="text-sm text-gray-500">{description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
