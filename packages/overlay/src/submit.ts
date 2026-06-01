import type { Comment, NewComment, Rect } from "./types";

export interface DraftLike {
  selector: string;
  text: string;
  tag: string;
  classes: string;
  component: string | null;
  source: string | null;
  rect: Rect | null;
}

/** Builds a comment from a draft (+ optional screenshot capture) and posts it. */
export async function submitComment(
  client: { addComment: (input: NewComment) => Promise<Comment> | Promise<unknown> },
  draft: DraftLike,
  text: string,
  capture?: () => Promise<string | null>,
  author?: string | null,
): Promise<void> {
  let screenshot: string | null = null;
  if (capture) {
    try {
      screenshot = await capture();
    } catch {
      screenshot = null;
    }
  }
  await client.addComment({
    comment: text,
    url: typeof location !== "undefined" ? location.pathname + location.search : "",
    selector: draft.selector,
    text: draft.text,
    tag: draft.tag,
    classes: draft.classes,
    component: draft.component,
    source: draft.source,
    rect: draft.rect,
    screenshot,
    author: author ?? null,
  });
}
