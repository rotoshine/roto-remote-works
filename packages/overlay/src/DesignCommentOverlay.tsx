import { useCallback, useEffect, useRef, useState } from "react";
import type { BridgeClient } from "./client";
import type { ApplyOrigin, Comment, CommentStatus, Question, Status } from "./types";
import { capture, type Captured } from "./selector";
import type { Box, Point } from "./position";
import { useDraggable } from "./useDraggable";
import { submitComment } from "./submit";
import { WebAskModal } from "./WebAskModal";
import { ProgressPanel } from "./ProgressPanel";
import { loadGrabEngine, type GrabEngine, type Grab } from "./grab-engine";

export interface DesignCommentOverlayProps {
  client: BridgeClient;
  pollMs?: number;
  origin?: ApplyOrigin;
  /** Optional screenshot capture; result (PNG data URL) is attached to comments. */
  captureScreenshot?: () => Promise<string | null>;
  /** Who is commenting (designer/PM/engineer); attached to each comment. */
  author?: string;
  /** Injected for tests; defaults to the real react-grab adapter. */
  grabEngineLoader?: () => Promise<GrabEngine>;
}

const IDLE: Status = { state: "idle", currentStep: null, perComment: {}, result: null, updatedAt: "" };

const STATUS_BADGE: Record<CommentStatus, string> = {
  open: "●",
  queued: "…",
  applying: "⟳",
  resolved: "✓",
};

type Draft = Captured & { px: number; py: number };
type Result = NonNullable<Status["result"]>;

// approx sizes; useDraggable uses them to keep each panel (and its controls) on-screen
const DRAFT_SIZE: Box = { w: 288, h: 200 };
const PANEL_SIZE: Box = { w: 288, h: 320 };
const DOCK_SIZE: Box = { w: 288, h: 200 };
const RESULT_SIZE: Box = { w: 352, h: 64 };

// default corners (clamped on mount) so the floating panels don't all stack on one spot
const MARGIN = 16;
const FAB_CLEARANCE = 64; // the bottom-right corner is occupied by the fixed FAB
// comment panel: bottom-right, lifted above the FAB (its original home)
const bottomRight = (s: Box): Point => ({ left: window.innerWidth - s.w - MARGIN, top: window.innerHeight - s.h - FAB_CLEARANCE });
const bottomLeft = (s: Box): Point => ({ left: MARGIN, top: window.innerHeight - s.h - MARGIN });
const topRight = (s: Box): Point => ({ left: window.innerWidth - s.w - MARGIN, top: MARGIN });

export function DesignCommentOverlay({
  client,
  pollMs = 1500,
  origin = "local",
  captureScreenshot,
  author,
  grabEngineLoader = loadGrabEngine,
}: DesignCommentOverlayProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [status, setStatus] = useState<Status>(IDLE);
  const [question, setQuestion] = useState<Question | null>(null);
  const [mode, setMode] = useState<"off" | "selecting">("off");
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftText, setDraftText] = useState("");
  const [hover, setHover] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [dismissedResultAt, setDismissedResultAt] = useState<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const [c, s, q] = await Promise.all([
        client.listComments(),
        client.getStatus(),
        client.getQuestion(),
      ]);
      setComments(c);
      setStatus(s);
      setQuestion(q);
    } catch {
      /* bridge unreachable — keep last known state */
    }
  }, [client]);

  useEffect(() => {
    void poll();
    const t = setInterval(() => void poll(), pollMs);
    return () => clearInterval(t);
  }, [poll, pollMs]);

  const active = comments.filter((c) => c.status !== "resolved");
  const running = status.state === "applying" || status.state === "queued";

  const engineRef = useRef<Promise<GrabEngine> | null>(null);

  useEffect(() => {
    return () => {
      void engineRef.current?.then((e) => e.dispose());
    };
  }, []);

  // comment-mode: hover-highlight the element under the cursor (inspector-style),
  // grab via GrabEngine to start a draft, Esc to exit.
  useEffect(() => {
    if (mode !== "selecting") {
      setHover(null);
      return;
    }
    let disposed = false;
    let unsub: (() => void) | undefined;
    if (!engineRef.current) engineRef.current = grabEngineLoader();
    void engineRef.current.then((engine) => {
      if (disposed) return; // unmounted/exited while loading — do not subscribe
      unsub = engine.onGrab((g: Grab) => {
        if (g.element instanceof Element && g.element.closest("[data-rrw-host]")) return;
        const r = g.element.getBoundingClientRect();
        setDraft({ ...capture(g.element, { source: g.source, component: g.component }), px: r.left, py: r.top });
        setDraftText("");
        setHover(null);
        setMode("off");
      });
      engine.activate();
    });

    const isUi = (t: EventTarget | null) => t instanceof Element && !!t.closest("[data-rrw-ui]");
    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || isUi(el)) return setHover(null);
      const r = el.getBoundingClientRect();
      setHover({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMode("off");
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("keydown", onKey, true);
    document.body.style.cursor = "crosshair";
    return () => {
      disposed = true;
      unsub?.();
      void engineRef.current?.then((e) => e.deactivate());
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.cursor = "";
      setHover(null);
    };
  }, [mode, grabEngineLoader]);

  const submitDraft = useCallback(async () => {
    if (!draft || !draftText.trim()) return;
    await submitComment(client, draft, draftText.trim(), captureScreenshot, author);
    setDraft(null);
    setDraftText("");
    void poll();
  }, [client, draft, draftText, captureScreenshot, author, poll]);

  const requestApply = useCallback(async () => {
    try {
      await client.apply(origin);
    } catch {
      /* busy or unreachable — the next poll reflects the real state */
    }
    void poll();
  }, [client, origin, poll]);

  const clearComments = useCallback(async () => {
    await client.clearComments();
    void poll();
  }, [client, poll]);

  const answer = useCallback(
    async (value: string) => {
      if (!question) return;
      await client.answer(question.id, value);
      setQuestion(null);
      void poll();
    },
    [client, question, poll],
  );

  const cancelQuestion = useCallback(async () => {
    if (!question) return;
    await client.cancel(question.id);
    setQuestion(null);
    void poll();
  }, [client, question, poll]);

  return (
    <div data-rrw-ui className="rrw-root">
      {mode === "selecting" && hover && (
        <div
          data-rrw-highlight
          className="rrw-highlight"
          style={{ left: hover.left, top: hover.top, width: hover.width, height: hover.height }}
        />
      )}

      {question && question.status === "pending" && (
        <div className="rrw-backdrop">
          <WebAskModal question={question} onAnswer={answer} onCancel={cancelQuestion} />
        </div>
      )}

      {running && <ProgressDock status={status} comments={active} />}

      {status.result && status.result.at !== dismissedResultAt && (
        <ResultBanner result={status.result} onDismiss={() => setDismissedResultAt(status.result?.at ?? null)} />
      )}

      {draft && (
        <DraftCard
          key={`${draft.px},${draft.py}`}
          draft={draft}
          draftText={draftText}
          onChangeText={setDraftText}
          onCancel={() => {
            setDraft(null);
            setDraftText("");
          }}
          onSubmit={() => void submitDraft()}
        />
      )}

      {panelOpen && (
        <CommentPanel comments={comments} running={running} onClear={() => void clearComments()} onApply={() => void requestApply()} />
      )}

      <button
        className="rrw-fab"
        data-rrw-ui
        type="button"
        onClick={() => {
          setMode(mode === "selecting" ? "off" : "selecting");
          setPanelOpen(true);
        }}
      >
        {mode === "selecting" ? "✕ 취소" : "＋ 코멘트"}
      </button>
    </div>
  );
}

/** Comment draft card, anchored next to the clicked element; drag by its header. */
function DraftCard({
  draft,
  draftText,
  onChangeText,
  onCancel,
  onSubmit,
}: {
  draft: Draft;
  draftText: string;
  onChangeText: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { style, handleProps } = useDraggable({ size: DRAFT_SIZE, initial: { left: draft.px, top: draft.py + 12 } });
  return (
    <div className="rrw-card rrw-draft" style={style}>
      <div className="rrw-draft-meta rrw-draft-handle" title="드래그해서 이동" {...handleProps}>
        <span className="rrw-draft-grip">⠿</span>
        {draft.tag}
        {draft.component ? ` · <${draft.component}>` : ""}
      </div>
      <textarea
        className="rrw-input"
        value={draftText}
        onChange={(e) => onChangeText(e.target.value)}
        placeholder="이 요소 수정 요청…"
        rows={3}
      />
      <div className="rrw-row">
        <button className="rrw-btn rrw-btn-ghost" type="button" onClick={onCancel}>
          취소
        </button>
        <button className="rrw-btn rrw-btn-primary" type="button" onClick={onSubmit} disabled={!draftText.trim()}>
          저장
        </button>
      </div>
    </div>
  );
}

/** Live run progress; drag by the grip. Default corner: bottom-left. */
function ProgressDock({ status, comments }: { status: Status; comments: Comment[] }) {
  const { style, handleProps } = useDraggable({ size: DOCK_SIZE, initial: bottomLeft(DOCK_SIZE) });
  return (
    <div className="rrw-dock rrw-dock-progress" style={style}>
      <div className="rrw-dock-handle" title="드래그해서 이동" {...handleProps}>
        <span className="rrw-drag-grip">⠿</span>
      </div>
      <ProgressPanel status={status} comments={comments} />
    </div>
  );
}

/** Apply outcome / PR link banner; drag by the grip. Default corner: top-right. */
function ResultBanner({ result, onDismiss }: { result: Result; onDismiss: () => void }) {
  const { style, handleProps } = useDraggable({ size: RESULT_SIZE, initial: topRight(RESULT_SIZE) });
  return (
    <div className="rrw-card rrw-result" style={style}>
      <span className="rrw-result-handle rrw-drag-grip" title="드래그해서 이동" {...handleProps}>
        ⠿
      </span>
      <span className="rrw-result-icon">{result.ok ? "✅" : "⚠️"}</span>
      <span className="rrw-result-text">{result.summary ?? (result.ok ? "적용 완료" : "적용 실패")}</span>
      {result.prUrl && (
        <a className="rrw-result-link" href={result.prUrl} target="_blank" rel="noreferrer">
          PR 보기 ↗
        </a>
      )}
      <button className="rrw-btn rrw-btn-ghost" type="button" onClick={onDismiss}>
        닫기
      </button>
    </div>
  );
}

/** Comment list + apply button; drag by its header. Default corner: bottom-right. */
function CommentPanel({
  comments,
  running,
  onClear,
  onApply,
}: {
  comments: Comment[];
  running: boolean;
  onClear: () => void;
  onApply: () => void;
}) {
  const { style, handleProps } = useDraggable({ size: PANEL_SIZE, initial: bottomRight(PANEL_SIZE) });
  const open = comments.filter((c) => c.status === "open");
  const resolved = comments.filter((c) => c.status === "resolved");
  // open/in-progress first, resolved last
  const ordered = [...comments].sort((a, b) => Number(a.status === "resolved") - Number(b.status === "resolved"));
  return (
    <div className="rrw-card rrw-panel" style={style}>
      <div className="rrw-panel-head" title="드래그해서 이동" {...handleProps}>
        <strong>
          <span className="rrw-drag-grip">⠿</span> 코멘트 · 열림 {open.length}
          {resolved.length > 0 ? ` · 완료 ${resolved.length}` : ""}
        </strong>
        {comments.length > 0 && !running && (
          <button
            className="rrw-btn rrw-btn-ghost"
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onClear}
          >
            지우기
          </button>
        )}
      </div>
      {open.length > 0 && (
        <button
          className="rrw-btn rrw-btn-primary rrw-panel-apply"
          type="button"
          onClick={onApply}
          disabled={running}
        >
          {running ? "🤖 처리 중…" : `🤖 Claude에게 수정 요청 (${open.length})`}
        </button>
      )}
      <ul className="rrw-panel-list">
        {ordered.map((c) => (
          <li key={c.id} className="rrw-panel-item" data-status={c.status} data-resolved={c.status === "resolved"}>
            <span className="rrw-status" data-status={c.status} title={c.status}>
              {STATUS_BADGE[c.status]}
            </span>
            {c.author ? <strong className="rrw-panel-author">{c.author}: </strong> : null}
            {c.comment}
          </li>
        ))}
      </ul>
    </div>
  );
}
