import { cn } from "@/lib/cn";

type BadgeVariant = "default" | "danger" | "warning" | "success" | "info" | "muted";

const styles: Record<BadgeVariant, string> = {
  default: "bg-blue-100 text-blue-800",
  danger: "bg-red-100 text-red-700",
  warning: "bg-amber-100 text-amber-700",
  success: "bg-emerald-100 text-emerald-700",
  info: "bg-cyan-100 text-cyan-700",
  muted: "bg-gray-100 text-gray-600",
};

export function Badge({ children, variant = "default", className }: {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", styles[variant], className)}>
      {children}
    </span>
  );
}