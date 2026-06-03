// Self-contained copy of the bridge contract so the overlay can be vendored
// into a consumer project without a dependency on @rrw/bridge.

export type CommentStatus = "open" | "queued" | "applying" | "resolved";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Comment {
  id: string;
  comment: string;
  status: CommentStatus;
  url: string;
  selector: string;
  text: string;
  tag: string;
  classes: string;
  component: string | null;
  source: string | null;
  rect: Rect | null;
  screenshot?: string | null;
  author?: string | null;
  createdAt: string;
}

export interface NewComment {
  comment: string;
  url?: string;
  selector?: string;
  text?: string;
  tag?: string;
  classes?: string;
  component?: string | null;
  source?: string | null;
  rect?: Rect | null;
  /** PNG data URL captured at comment time. */
  screenshot?: string | null;
  author?: string | null;
}

export interface CommentPatch {
  status?: CommentStatus;
  comment?: string;
}

export type ApplyOrigin = "local" | "remote";

export interface ApplyRequest {
  requestedAt: string;
  origin: ApplyOrigin;
  ids: string[];
}

export type RunState = "idle" | "queued" | "applying" | "done" | "error";

export interface ApplyResultInfo {
  ok: boolean;
  prUrl?: string | null;
  summary?: string | null;
  at: string;
}

export interface Status {
  state: RunState;
  currentStep: string | null;
  perComment: Record<string, CommentStatus>;
  result: ApplyResultInfo | null;
  updatedAt: string;
}

export interface StatusPatch {
  state?: RunState;
  currentStep?: string | null;
  perComment?: Record<string, CommentStatus>;
  result?: ApplyResultInfo | null;
}

export type QuestionStatus = "pending" | "answered" | "cancelled";

export interface Question {
  id: string;
  text: string;
  options: string[];
  status: QuestionStatus;
  answer: string | null;
  askedAt: string;
}
