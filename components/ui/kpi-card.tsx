import { cn } from "@/lib/cn";

type Variant = "default" | "danger" | "warning" | "success" | "info" | "muted";

interface KpiCardProps {
  label: string;
  value: string | number;
  variant?: Variant;
  subtext?: string;
}

const accentMap: Record<Variant, string> = {
  default: "border-l-blue-500",
  danger: "border-l-red-500",
  warning: "border-l-amber-400",
  success: "border-l-emerald-500",
  info: "border-l-cyan-400",
  muted: "border-l-gray-300",
};

const valueMap: Record<Variant, string> = {
  default: "text-gray-900",
  danger: "text-red-600",
  warning: "text-amber-600",
  success: "text-emerald-600",
  info: "text-cyan-600",
  muted: "text-gray-400",
};

export function KpiCard({ label, value, variant = "default", subtext }: KpiCardProps) {
  return (
    <div className={cn("bg-white rounded-lg border-l-4 shadow-sm px-4 py-3", accentMap[variant])}>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{label}</p>
      <p className={cn("text-2xl font-bold", valueMap[variant])}>{value}</p>
      {subtext && <p className="text-xs text-gray-400 mt-0.5">{subtext}</p>}
    </div>
  );
}