import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

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
  /** Relative path to the saved screenshot (e.g. "screenshots/<id>.png"), or null. */
  screenshot?: string | null;
  /** Who left the comment (designer/PM/engineer); null if anonymous. */
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
  /** A PNG data URL ("data:image/png;base64,…") captured at comment time. */
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

export type ApplyResult =
  | { ok: true; request: ApplyRequest }
  | { ok: false; reason: "no-open" | "busy" };

export type RunState = "idle" | "queued" | "applying" | "done" | "error";

export interface Status {
  state: RunState;
  currentStep: string | null;
  perComment: Record<string, CommentStatus>;
  updatedAt: string;
}

export interface StatusPatch {
  state?: RunState;
  currentStep?: string | null;
  perComment?: Record<string, CommentStatus>;
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

export interface NewQuestion {
  text: string;
  options?: string[];
}

export interface StoreOptions {
  file: string;
  id?: () => string;
  now?: () => string;
}

export class Store {
  private readonly file: string;
  private readonly dir: string;
  private readonly genId: () => string;
  private readonly now: () => string;
  /** Serializes read-modify-write operations to avoid lost updates. */
  private lock: Promise<unknown> = Promise.resolve();

  constructor(opts: StoreOptions) {
    this.file = opts.file;
    this.dir = dirname(opts.file);
    this.genId = opts.id ?? (() => randomUUID());
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  private path(name: string): string {
    return join(this.dir, name);
  }

  private mutate<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async readJson<T>(file: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await fs.readFile(file, "utf8")) as T;
    } catch {
      return fallback;
    }
  }

  private async writeJson(file: string, value: unknown): Promise<void> {
    await fs.mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2));
    await fs.rename(tmp, file);
  }

  // ── comments ──────────────────────────────────────────────
  private async readComments(): Promise<Comment[]> {
    const parsed = await this.readJson<unknown>(this.file, []);
    return Array.isArray(parsed) ? (parsed as Comment[]) : [];
  }

  private writeComments(list: Comment[]): Promise<void> {
    return this.writeJson(this.file, list);
  }

  async listComments(): Promise<Comment[]> {
    return this.readComments();
  }

  addComment(input: NewComment): Promise<Comment> {
    return this.mutate(async () => {
      const comment: Comment = {
        id: this.genId(),
        comment: input.comment,
        status: "open",
        url: input.url ?? "",
        selector: input.selector ?? "",
        text: input.text ?? "",
        tag: input.tag ?? "",
        classes: input.classes ?? "",
        component: input.component ?? null,
        source: input.source ?? null,
        rect: input.rect ?? null,
        screenshot: null,
        author: input.author ?? null,
        createdAt: this.now(),
      };
      if (input.screenshot) {
        const ref = await this.saveScreenshot(comment.id, input.screenshot);
        if (ref) comment.screenshot = ref;
      }
      const list = await this.readComments();
      list.push(comment);
      await this.writeComments(list);
      return comment;
    });
  }

  private async saveScreenshot(id: string, dataUrl: string): Promise<string | null> {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) return null;
    const rel = `screenshots/${id}.png`;
    const file = this.path(rel);
    await fs.mkdir(dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.from(m[1]!, "base64"));
    return rel;
  }

  getScreenshot(id: string): Promise<Buffer | null> {
    return fs.readFile(this.path(`screenshots/${id}.png`)).catch(() => null);
  }

  patchComment(id: string, patch: CommentPatch): Promise<Comment | null> {
    return this.mutate(async () => {
      const list = await this.readComments();
      const idx = list.findIndex((c) => c.id === id);
      if (idx === -1) return null;
      const updated: Comment = { ...list[idx]! };
      if (patch.status !== undefined) updated.status = patch.status;
      if (patch.comment !== undefined) updated.comment = patch.comment;
      list[idx] = updated;
      await this.writeComments(list);
      return updated;
    });
  }

  deleteComment(id: string): Promise<boolean> {
    return this.mutate(async () => {
      const list = await this.readComments();
      const next = list.filter((c) => c.id !== id);
      if (next.length === list.length) return false;
      await this.writeComments(next);
      return true;
    });
  }

  clearComments(): Promise<void> {
    return this.mutate(async () => {
      await this.writeComments([]);
    });
  }

  // ── apply / request ───────────────────────────────────────
  requestApply(origin: ApplyOrigin): Promise<ApplyResult> {
    return this.mutate(async () => {
      // single-flight: reject if a run is already queued/applying
      const status = await this.readJson<Status>(this.path("status.json"), this.defaultStatus());
      if (status.state === "queued" || status.state === "applying") {
        return { ok: false, reason: "busy" };
      }
      const list = await this.readComments();
      const open = list.filter((c) => c.status === "open");
      if (open.length === 0) return { ok: false, reason: "no-open" };
      for (const c of list) if (c.status === "open") c.status = "queued";
      await this.writeComments(list);
      const request: ApplyRequest = {
        requestedAt: this.now(),
        origin,
        ids: open.map((c) => c.id),
      };
      await this.writeJson(this.path("request.json"), request);
      await this.writeJson(this.path("status.json"), { ...status, state: "queued", updatedAt: this.now() });
      return { ok: true, request };
    });
  }

  getRequest(): Promise<ApplyRequest | null> {
    return this.readJson<ApplyRequest | null>(this.path("request.json"), null);
  }

  clearRequest(): Promise<void> {
    return this.mutate(async () => {
      await this.writeJson(this.path("request.json"), null);
    });
  }

  // ── status (progress) ─────────────────────────────────────
  private defaultStatus(): Status {
    return { state: "idle", currentStep: null, perComment: {}, updatedAt: this.now() };
  }

  getStatus(): Promise<Status> {
    return this.readJson<Status>(this.path("status.json"), this.defaultStatus());
  }

  setStatus(patch: StatusPatch): Promise<Status> {
    return this.mutate(async () => {
      const cur = await this.readJson<Status>(this.path("status.json"), this.defaultStatus());
      const next: Status = {
        state: patch.state ?? cur.state,
        currentStep: patch.currentStep !== undefined ? patch.currentStep : cur.currentStep,
        perComment: { ...cur.perComment, ...(patch.perComment ?? {}) },
        updatedAt: this.now(),
      };
      await this.writeJson(this.path("status.json"), next);
      return next;
    });
  }

  // ── question (web-ask) ────────────────────────────────────
  postQuestion(input: NewQuestion): Promise<Question> {
    return this.mutate(async () => {
      const q: Question = {
        id: this.genId(),
        text: input.text,
        options: input.options ?? [],
        status: "pending",
        answer: null,
        askedAt: this.now(),
      };
      await this.writeJson(this.path("question.json"), q);
      return q;
    });
  }

  currentQuestion(): Promise<Question | null> {
    return this.readJson<Question | null>(this.path("question.json"), null);
  }

  async getQuestion(): Promise<Question | null> {
    const q = await this.currentQuestion();
    return q && q.status === "pending" ? q : null;
  }

  answerQuestion(id: string, answer: string): Promise<Question | null> {
    return this.mutate(async () => {
      const q = await this.readJson<Question | null>(this.path("question.json"), null);
      if (!q || q.id !== id || q.status !== "pending") return null;
      const next: Question = { ...q, status: "answered", answer };
      await this.writeJson(this.path("question.json"), next);
      return next;
    });
  }

  cancelQuestion(id: string): Promise<Question | null> {
    return this.mutate(async () => {
      const q = await this.readJson<Question | null>(this.path("question.json"), null);
      if (!q || q.id !== id) return null;
      const next: Question = { ...q, status: "cancelled" };
      await this.writeJson(this.path("question.json"), next);
      return next;
    });
  }
}
