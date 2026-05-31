import type { Comment, CommentStatus, Status } from "./types";

const STATUS_LABEL: Record<CommentStatus, string> = {
  open: "대기",
  queued: "대기열",
  applying: "처리중",
  resolved: "완료",
};

export interface ProgressPanelProps {
  status: Status;
  comments: Comment[];
}

/** Shows the live run progress: a current-step line + per-comment status badges. */
export function ProgressPanel({ status, comments }: ProgressPanelProps) {
  return (
    <div className="rrw-card rrw-progress">
      {status.state !== "idle" && status.currentStep && (
        <p className="rrw-progress-step">지금: {status.currentStep}</p>
      )}
      <ul className="rrw-progress-list">
        {comments.map((c) => {
          const effective = status.perComment[c.id] ?? c.status;
          return (
            <li key={c.id} className="rrw-progress-item">
              <span className="rrw-progress-label">{c.comment}</span>
              <span className={`rrw-badge rrw-badge-${effective}`} data-status={effective}>
                {STATUS_LABEL[effective]}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
