import type React from "react";
import { useCallback, useEffect, useState } from "react";
import type { BridgeClient } from "./client";
import type { ApplyOrigin, Comment, CommentStatus, Question, Status } from "./types";
import { capture, type Captured } from "./selector";
import { clampToViewport, type Point } from "./position";
import { submitComment } from "./submit";
import { WebAskModal } from "./WebAskModal";
import { ProgressPanel } from "./ProgressPanel";

export interface DesignCommentOverlayProps {
  client: BridgeClient;
  pollMs?: number;
  origin?: ApplyOrigin;
  /** Optional screenshot capture; result (PNG data URL) is attached to comments. */
  captureScreenshot?: () => Promise<string | null>;
  /** Who is commenting (designer/PM/engineer); attached to each comment. */
  author?: string;
}

const IDLE: Status = { state: "idle", currentStep: null, perComment: {}, result: null, updatedAt: "" };

const STATUS_BADGE: Record<CommentStatus, string> = {
  open: "●",
  queued: "…",
  applying: "⟳",
  resolved: "✓",
};

type Draft = Captured & { px: number; py: number };

// approx draft-card size, used to keep it (and its buttons) on-screen
const DRAFT_SIZE = { w: 288, h: 200 };
const viewport = () => ({ w: window.innerWidth, h: window.innerHeight });

export function DesignCommentOverlay({
  client,
  pollMs = 1500,
  origin = "local",
  captureScreenshot,
  author,
}: DesignCommentOverlayProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [status, setStatus] = useState<Status>(IDLE);
  const [question, setQuestion] = useState<Question | null>(null);
  const [mode, setMode] = useState<"off" | "selecting">("off");
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftPos, setDraftPos] = useState<Point | null>(null);
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
  const open = active.filter((c) => c.status === "open");
  const resolved = comments.filter((c) => c.status === "resolved");
  // open/in-progress first, resolved last
  const ordered = [...comments].sort(
    (a, b) => Number(a.status === "resolved") - Number(b.status === "resolved"),
  );
  const running = status.state === "applying" || status.state === "queued";

  // comment-mode: hover-highlight the element under the cursor (inspector-style),
  // click to start a draft, Esc to exit.
  useEffect(() => {
    if (mode !== "selecting") {
      setHover(null);
      return;
    }
    const isUi = (t: EventTarget | null) => t instanceof Element && !!t.closest("[data-rrw-ui]");
    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || isUi(el)) {
        setHover(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setHover({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    const onClick = (e: MouseEvent) => {
      if (isUi(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || isUi(el)) return;
      setDraft({ ...capture(el), px: e.clientX, py: e.clientY });
      setDraftText("");
      // place the draft near the click but clamped fully on-screen
      setDraftPos(clampToViewport({ left: e.clientX, top: e.clientY + 12 }, DRAFT_SIZE, viewport()));
      setHover(null);
      setMode("off");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMode("off");
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    document.body.style.cursor = "crosshair";
    return () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.cursor = "";
      setHover(null);
    };
  }, [mode]);

  const submitDraft = useCallback(async () => {
    if (!draft || !draftText.trim()) return;
    await submitComment(client, draft, draftText.trim(), captureScreenshot, author);
    setDraft(null);
    setDraftPos(null);
    setDraftText("");
    void poll();
  }, [client, draft, draftText, captureScreenshot, author, poll]);

  // drag the draft card by its header so it never gets stuck off-screen
  const startDraftDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const base = draftPos ?? { left: e.clientX, top: e.clientY };
      const onMove = (ev: MouseEvent) => {
        setDraftPos(
          clampToViewport(
            { left: base.left + (ev.clientX - startX), top: base.top + (ev.clientY - startY) },
            DRAFT_SIZE,
            viewport(),
          ),
        );
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [draftPos],
  );

  const requestApply = useCallback(async () => {
    try {
      await client.apply(origin);
    } catch {
      /* busy or unreachable — the next poll reflects the real state */
    }
    void poll();
  }, [client, origin, poll]);

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

      {running && (
        <div className="rrw-dock rrw-dock-progress">
          <ProgressPanel status={status} comments={active} />
        </div>
      )}

      {status.result && status.result.at !== dismissedResultAt && (
        <div className="rrw-card rrw-result">
          <span className="rrw-result-icon">{status.result.ok ? "✅" : "⚠️"}</span>
          <span className="rrw-result-text">
            {status.result.summary ?? (status.result.ok ? "적용 완료" : "적용 실패")}
          </span>
          {status.result.prUrl && (
            <a className="rrw-result-link" href={status.result.prUrl} target="_blank" rel="noreferrer">
              PR 보기 ↗
            </a>
          )}
          <button
            className="rrw-btn rrw-btn-ghost"
            type="button"
            onClick={() => setDismissedResultAt(status.result?.at ?? null)}
          >
            닫기
          </button>
        </div>
      )}

      {draft && (
        <div
          className="rrw-card rrw-draft"
          style={{ left: (draftPos ?? { left: draft.px, top: draft.py + 12 }).left, top: (draftPos ?? { left: draft.px, top: draft.py + 12 }).top }}
        >
          <div className="rrw-draft-meta rrw-draft-handle" onMouseDown={startDraftDrag} title="드래그해서 이동">
            <span className="rrw-draft-grip">⠿</span>
            {draft.tag}
            {draft.component ? ` · <${draft.component}>` : ""}
          </div>
          <textarea
            className="rrw-input"
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="이 요소 수정 요청…"
            rows={3}
          />
          <div className="rrw-row">
            <button
              className="rrw-btn rrw-btn-ghost"
              type="button"
              onClick={() => {
                setDraft(null);
                setDraftPos(null);
              }}
            >
              취소
            </button>
            <button
              className="rrw-btn rrw-btn-primary"
              type="button"
              onClick={() => void submitDraft()}
              disabled={!draftText.trim()}
            >
              저장
            </button>
          </div>
        </div>
      )}

      {panelOpen && (
        <div className="rrw-card rrw-panel">
          <div className="rrw-panel-head">
            <strong>
              코멘트 · 열림 {open.length}
              {resolved.length > 0 ? ` · 완료 ${resolved.length}` : ""}
            </strong>
            {comments.length > 0 && !running && (
              <button
                className="rrw-btn rrw-btn-ghost"
                type="button"
                onClick={async () => {
                  await client.clearComments();
                  void poll();
                }}
              >
                지우기
              </button>
            )}
          </div>
          {open.length > 0 && (
            <button
              className="rrw-btn rrw-btn-primary rrw-panel-apply"
              type="button"
              onClick={() => void requestApply()}
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
