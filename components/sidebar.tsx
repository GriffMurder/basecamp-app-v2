"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import {
  LayoutDashboard, Users, CheckSquare, Building2,
  BarChart2, Settings, LogOut, Briefcase, Cog, FileText,
  Clock, Shield, UserCircle, DollarSign, ThumbsUp,
  Activity, AlertTriangle, ShieldAlert, TrendingUp, Smile, ClipboardList,
} from "lucide-react";

const links = [
  { href: "/dashboard", label: "Command Center", icon: LayoutDashboard },
  { href: "/todos", label: "Tasks", icon: CheckSquare },
  { href: "/customers", label: "Clients", icon: Building2 },
  { href: "/customers/health", label: "Client Health", icon: ShieldAlert },
  { href: "/vas", label: "Team", icon: Users },
  { href: "/vas/health", label: "Team Health", icon: Activity },
  { href: "/vas/scorecards", label: "Scorecards", icon: FileText },
  { href: "/escalations", label: "Escalations", icon: AlertTriangle },
  { href: "/ops", label: "Operations", icon: Cog },
  { href: "/ops/briefs", label: "Ops Briefs", icon: BarChart2 },
  { href: "/buckets", label: "Buckets", icon: DollarSign },
  { href: "/approvals", label: "Approvals", icon: ThumbsUp },
  { href: "/quality", label: "Quality Signals", icon: AlertTriangle },
  { href: "/plans", label: "Success Plans", icon: FileText },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/time-tracking", label: "Time Tracking", icon: Clock },
  { href: "/insights", label: "Insights", icon: BarChart2 },
  { href: "/audit", label: "Audit Log", icon: Shield },
  { href: "/admin/dim", label: "DIM", icon: Shield },
  { href: "/admin/scores", label: "Scores", icon: BarChart2 },
  { href: "/admin/car-reports", label: "CAR Reports", icon: FileText },
  { href: "/admin/advantage-reports", label: "Advantage Reports", icon: TrendingUp },
  { href: "/admin/sentiment", label: "Sentiment", icon: Smile },
  { href: "/admin/intake", label: "Intake Gate", icon: ClipboardList },
  { href: "/admin", label: "Admin", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex flex-col w-56 min-h-screen bg-gray-900 text-gray-100 shrink-0">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-700">
        <Briefcase className="w-5 h-5 text-blue-400" />
        <span className="font-bold text-white text-sm">TaskBullet Ops</span>
      </div>
      <nav className="flex-1 py-4 space-y-0.5 px-2">
        {links.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                active
                  ? "bg-blue-600 text-white"
                  : "text-gray-300 hover:bg-gray-800 hover:text-white"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="px-2 pb-4 space-y-0.5">
        <Link
          href="/profile"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
            pathname === "/profile"
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:bg-gray-800 hover:text-white"
          )}
        >
          <UserCircle className="w-4 h-4 shrink-0" />
          Profile
        </Link>
        <form action="/api/auth/signout" method="POST">
          <button
            type="submit"
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white transition-colors w-full"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}