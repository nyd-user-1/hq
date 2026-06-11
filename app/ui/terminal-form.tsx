"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function TerminalForm() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });
      if (!res.ok) {
        setError((await res.text()) || `error ${res.status}`);
      } else {
        setPrompt("");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          }}
          rows={3}
          placeholder="next input — sent to this session via claude -p (⌘↩ to send)"
          className="min-w-0 flex-1 resize-y rounded-md border border-zinc-700 bg-zinc-900 p-3 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
        />
        <button
          onClick={send}
          disabled={busy || !prompt.trim()}
          className="rounded-md bg-zinc-100 px-4 py-2 text-xs font-medium text-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
        >
          {busy ? "running…" : "send"}
        </button>
      </div>
      {busy && (
        <p className="font-mono text-xs text-zinc-500">
          claude is working — this waits for the full reply, can take minutes
        </p>
      )}
      {error && (
        <p className="whitespace-pre-wrap font-mono text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
