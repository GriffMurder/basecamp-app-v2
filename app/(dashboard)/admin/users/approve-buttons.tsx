"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/** Scrolls to and highlights a specific user row when ?approve= is present. */
export function ScrollToUser({ userId }: { userId: number }) {
  useEffect(() => {
    const el = document.getElementById(`user-row-${userId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-inset", "ring-amber-400");
      setTimeout(() => el.classList.remove("ring-2", "ring-inset", "ring-amber-400"), 3000);
    }
  }, [userId]);
  return null;
}

/** Approve (as Manager or VA) or Reject a pending user via PATCH /api/users/[id]. */
export function ApproveButtons({ userId }: { userId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function act(action: "manager" | "va" | "reject") {
    setBusy(action);
    try {
      const body =
        action === "manager" ? { role: "manager", active: true } :
        action === "va"      ? { role: "va",      active: true } :
                               { active: false };
      const res = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setDone(action === "reject" ? "Rejected" : `Approved as ${action}`);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    return (
      <span className="text-xs text-gray-400 italic">{done}</span>
    );
  }

  return (
    <div className="flex gap-1 justify-end">
      <button
        onClick={() => act("manager")}
        disabled={!!busy}
        className="px-2 py-1 text-xs bg-blue-600 text-white rounded font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
      >
        {busy === "manager" && <Loader2 className="w-3 h-3 animate-spin" />}
        Manager
      </button>
      <button
        onClick={() => act("va")}
        disabled={!!busy}
        className="px-2 py-1 text-xs bg-emerald-600 text-white rounded font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1"
      >
        {busy === "va" && <Loader2 className="w-3 h-3 animate-spin" />}
        VA
      </button>
      <button
        onClick={() => act("reject")}
        disabled={!!busy}
        className="px-2 py-1 text-xs bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100 disabled:opacity-50 flex items-center gap-1"
      >
        {busy === "reject" && <Loader2 className="w-3 h-3 animate-spin" />}
        Reject
      </button>
    </div>
  );
}