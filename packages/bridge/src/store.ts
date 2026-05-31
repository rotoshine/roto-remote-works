import { promises as fs } from "node:fs";
import { dirname } from "node:path";
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
}

export interface CommentPatch {
  status?: CommentStatus;
  comment?: string;
}

export interface StoreOptions {
  file: string;
  id?: () => string;
  now?: () => string;
}

export class Store {
  private readonly file: string;
  private readonly genId: () => string;
  private readonly now: () => string;
  /** Serializes read-modify-write operations to avoid lost updates. */
  private lock: Promise<unknown> = Promise.resolve();

  constructor(opts: StoreOptions) {
    this.file = opts.file;
    this.genId = opts.id ?? (() => randomUUID());
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  private mutate<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
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
        createdAt: this.now(),
      };
      const list = await this.readComments();
      list.push(comment);
      await this.writeComments(list);
      return comment;
    });
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

  private async readComments(): Promise<Comment[]> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Comment[]) : [];
    } catch {
      return [];
    }
  }

  private async writeComments(list: Comment[]): Promise<void> {
    await fs.mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(list, null, 2));
    await fs.rename(tmp, this.file);
  }
}
