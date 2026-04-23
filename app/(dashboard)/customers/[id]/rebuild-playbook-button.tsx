"use client";

import { useState } from "react";
import { RefreshCw, Loader2, CheckCircle } from "lucide-react";

export function RebuildPlaybookButton({ customerId }: { customerId: number }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleClick() {
    setState("loading");
    try {
      const res = await fetch(`/api/customers/${customerId}/rebuild-playbook`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(data.message ?? "Rebuild queued.");
        setState("done");
      } else {
        setMessage(data.error ?? "Failed to queue rebuild.");
        setState("error");
      }
    } catch {
      setMessage("Request failed.");
      setState("error");
    }
  }

  if (state === "loading") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Queuing…
      </span>
    );
  }

  if (state === "done") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600">
        <CheckCircle className="w-3.5 h-3.5" />
        {message}
      </span>
    );
  }

  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-red-600">
        {message}
      </span>
    );
  }

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-blue-600 border border-gray-200 rounded px-2.5 py-1 bg-white hover:border-blue-300 transition-colors"
    >
      <RefreshCw className="w-3 h-3" />
      Rebuild Playbook
    </button>
  );
}
