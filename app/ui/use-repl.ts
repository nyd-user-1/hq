"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type PermissionDecision =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message?: string };

export type ReplPermission = {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
};

// Client side of the live REPL. Given a session id + an `enabled` flag (the
// "live in HQ" status — true once HQ owns a warm process for this session, set
// on the first send), it starts the warm process, opens the SSE feed, and
// folds streaming events into a small live state: the in-flight assistant text
// (token-by-token), the current turn's tool calls, and any pending permission
// asks. Completed turns still land via the terminal's normal transcript poll —
// this layer adds instant streaming + the approve/deny cards on top.
export function useRepl(sessionId: string | null, enabled: boolean) {
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [liveTools, setLiveTools] = useState<{ id: string; name: string }[]>([]);
  const [permissions, setPermissions] = useState<ReplPermission[]>([]);
  const esRef = useRef<EventSource | null>(null);

  const post = useCallback(
    (body: Record<string, unknown>) =>
      fetch("/api/terminal/repl", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((r) => r.json())
        .catch(() => null),
    [],
  );

  const send = useCallback(
    async (text: string, images?: { data: string; mime: string }[], model?: string) => {
      if (!sessionId) return null;
      setLiveText("");
      setLiveTools([]);
      setBusy(true);
      // post() swallows fetch-layer failures (`.catch(() => null)`) and the route
      // returns `{ ok: false }` (200) when sendTurn can't write. In BOTH cases no
      // hq_sent/result SSE event ever arrives to lower `busy` — so we MUST clear
      // it here, or the terminal's optimistic `sending`/`busyRef` strand true and
      // the transcript poll (gated on !busyRef) freezes. Returning the result lets
      // doSend surface the failure to the user (the message never landed).
      const r = await post({ action: "send", session: sessionId, text, images, model });
      if (!r || r.ok === false) setBusy(false);
      return r as { ok?: boolean } | null;
    },
    [sessionId, post],
  );

  const stop = useCallback(async () => {
    if (!sessionId) return;
    await post({ action: "stop", session: sessionId });
  }, [sessionId, post]);

  const answer = useCallback(
    async (toolUseId: string, decision: PermissionDecision) => {
      if (!sessionId) return;
      setPermissions((p) => p.filter((x) => x.toolUseId !== toolUseId));
      await post({ action: "answer", session: sessionId, tool_use_id: toolUseId, decision });
    },
    [sessionId, post],
  );

  // While driving: start (idempotent) then subscribe to the event feed.
  useEffect(() => {
    if (!enabled || !sessionId) {
      setRunning(false);
      // setBusy(false) here is load-bearing: releasing `live` mid-turn (session
      // switch / pill / Resume) closes the SSE, so a `result` event can never
      // arrive to lower `busy`. Lowering it on disable gives the terminal's
      // repl.busy true→false edge-effect a single source of truth for clearing
      // its optimistic `sending`/`busyRef` flags — without it, those strand true
      // and the next session's transcript poll freezes (busyRef gates the commit).
      setBusy(false);
      setLiveText("");
      setLiveTools([]);
      setPermissions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      await post({ action: "start", session: sessionId });
      if (cancelled) return;
      const es = new EventSource(
        `/api/terminal/repl/stream?session=${encodeURIComponent(sessionId)}`,
      );
      esRef.current = es;
      es.onmessage = (m) => {
        let e: Record<string, unknown> & { event?: Record<string, unknown> };
        try { e = JSON.parse(m.data); } catch { return; }
        const t = e.type;
        if (t === "system" && e.subtype === "init") return setRunning(true);
        if (t === "hq_exit") { setRunning(false); setBusy(false); return; }
        if (t === "hq_sent") { setBusy(true); setLiveText(""); setLiveTools([]); return; }
        if (t === "result") { setBusy(false); setLiveText(""); setLiveTools([]); return; }
        if (t === "hq_permission") {
          const req = (e.request ?? {}) as Record<string, unknown>;
          const id = String(e.tool_use_id);
          setPermissions((p) =>
            p.some((x) => x.toolUseId === id)
              ? p
              : [...p, { toolUseId: id, toolName: String(req.tool_name ?? "tool"), input: (req.input ?? {}) as Record<string, unknown> }],
          );
          return;
        }
        if (t === "hq_permission_resolved") {
          const id = String(e.tool_use_id);
          setPermissions((p) => p.filter((x) => x.toolUseId !== id));
          return;
        }
        if (t === "stream_event" && e.event) {
          const ev = e.event as Record<string, unknown> & {
            content_block?: { type?: string; id?: string; name?: string };
            delta?: { type?: string; text?: string };
          };
          if (ev.type === "message_start") { setBusy(true); setLiveText(""); setLiveTools([]); }
          else if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
            setLiveTools((tl) => [...tl, { id: String(ev.content_block!.id), name: String(ev.content_block!.name) }]);
          } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
            setLiveText((s) => s + (ev.delta!.text ?? ""));
          }
        }
      };
      es.onerror = () => { /* EventSource auto-reconnects; buffer replays on reconnect */ };
    })();
    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
    };
  }, [enabled, sessionId, post]);

  return { running, busy, liveText, liveTools, permissions, send, stop, answer };
}
