"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap, Loader2, CheckCircle, X } from "lucide-react";

export function ClaimButton({ todoId }: { todoId: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    message: string;
    claimer: string;
    posted_to_basecamp: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClaim() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/todos/${todoId}/claim`, { method: "POST" });
      const data = await res.json() as {
        ok?: boolean;
        error?: string;
        message?: string;
        claimer?: string;
        posted_to_basecamp?: boolean;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Failed to claim task");
      } else {
        setResult({
          message: data.message ?? "",
          claimer: data.claimer ?? "",
          posted_to_basecamp: data.posted_to_basecamp ?? false,
        });
        router.refresh();
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-emerald-700 text-sm font-medium">
          <CheckCircle className="w-4 h-4" />
          <span>
            Task claimed by {result.claimer}
            {result.posted_to_basecamp ? " — update posted to Basecamp" : ""}
          </span>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3 relative">
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{result.message}</p>
          <button
            onClick={() => setResult(null)}
            className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleClaim}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Claiming…</>
        ) : (
          <><Zap className="w-4 h-4" /> Claim This Task</>
        )}
      </button>
      <p className="text-xs text-gray-400">
        Assigns you as the VA and posts an AI-generated client update to Basecamp.
      </p>
      {error && (
        <p className="text-xs text-red-600 font-medium">{error}</p>
      )}
    </div>
  );
}