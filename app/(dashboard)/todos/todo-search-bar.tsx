"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useTransition } from "react";
import { Search, X } from "lucide-react";

export function TodoSearchBar({ defaultValue = "" }: { defaultValue?: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  function submit(value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value.trim()) {
      params.set("q", value.trim());
    } else {
      params.delete("q");
    }
    params.delete("page"); // reset page on new search
    startTransition(() => router.push(`/todos?${params.toString()}`));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(inputRef.current?.value ?? "");
      }}
      className="relative flex items-center"
    >
      <Search className="absolute left-2.5 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
      <input
        ref={inputRef}
        type="search"
        defaultValue={defaultValue}
        placeholder="Search tasks…"
        className="pl-8 pr-8 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent w-56 transition-all"
      />
      {defaultValue && (
        <button
          type="button"
          onClick={() => {
            if (inputRef.current) inputRef.current.value = "";
            submit("");
          }}
          className="absolute right-2 text-gray-400 hover:text-gray-600"
          title="Clear search"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
      {pending && (
        <span className="absolute right-2 text-xs text-gray-400">…</span>
      )}
    </form>
  );
}
