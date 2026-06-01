import { describe, it, expect, vi } from "vitest";
import { submitComment, type DraftLike } from "./submit";

const draft: DraftLike = {
  selector: "h1",
  text: "Title",
  tag: "h1",
  classes: "hero",
  component: null,
  source: null,
  rect: null,
};

describe("submitComment", () => {
  it("captures a screenshot and attaches it to addComment", async () => {
    const addComment = vi.fn(async (i) => ({ id: "1", ...i }));
    const capture = vi.fn(async () => "data:image/png;base64,ABC");
    await submitComment({ addComment }, draft, "spacing off", capture);
    expect(capture).toHaveBeenCalled();
    expect(addComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment: "spacing off", selector: "h1", screenshot: "data:image/png;base64,ABC" }),
    );
  });

  it("attaches null when no capture fn is given", async () => {
    const addComment = vi.fn(async (i) => ({ id: "1", ...i }));
    await submitComment({ addComment }, draft, "x");
    expect(addComment).toHaveBeenCalledWith(expect.objectContaining({ comment: "x", screenshot: null }));
  });

  it("includes the author when provided", async () => {
    const addComment = vi.fn(async (i) => ({ id: "1", ...i }));
    await submitComment({ addComment }, draft, "x", undefined, "Designer A");
    expect(addComment).toHaveBeenCalledWith(expect.objectContaining({ author: "Designer A" }));
  });

  it("degrades to null when capture throws", async () => {
    const addComment = vi.fn(async (i) => ({ id: "1", ...i }));
    const capture = vi.fn(async () => {
      throw new Error("boom");
    });
    await submitComment({ addComment }, draft, "x", capture);
    expect(addComment).toHaveBeenCalledWith(expect.objectContaining({ screenshot: null }));
  });
});
