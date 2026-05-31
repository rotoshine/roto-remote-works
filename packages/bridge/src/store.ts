import { promises as fs } from "node:fs";
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

export interface StoreOptions {
  file: string;
  id?: () => string;
  now?: () => string;
}

export class Store {
  private readonly file: string;
  private readonly genId: () => string;
  private readonly now: () => string;

  constructor(opts: StoreOptions) {
    this.file = opts.file;
    this.genId = opts.id ?? (() => randomUUID());
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  async listComments(): Promise<Comment[]> {
    return this.readComments();
  }

  async addComment(input: NewComment): Promise<Comment> {
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
    await fs.writeFile(this.file, JSON.stringify(list, null, 2));
  }
}
