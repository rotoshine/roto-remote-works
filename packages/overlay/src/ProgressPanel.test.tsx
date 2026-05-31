import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressPanel } from "./ProgressPanel";
import type { Comment, CommentStatus, Status } from "./types";

function comment(id: string, text: string, status: CommentStatus = "open"): Comment {
  return {
    id,
    comment: text,
    status,
    url: "",
    selector: "",
    text: "",
    tag: "",
    classes: "",
    component: null,
    source: null,
    rect: null,
    createdAt: "t",
  };
}

const status = (over: Partial<Status> = {}): Status => ({
  state: "idle",
  currentStep: null,
  perComment: {},
  updatedAt: "t",
  ...over,
});

describe("ProgressPanel", () => {
  it("shows the current step line when a run is active", () => {
    render(<ProgressPanel status={status({ state: "applying", currentStep: "fixing header" })} comments={[]} />);
    expect(screen.getByText(/fixing header/)).toBeInTheDocument();
  });

  it("hides the step line when idle", () => {
    render(<ProgressPanel status={status()} comments={[]} />);
    expect(screen.queryByText(/지금:/)).toBeNull();
  });

  it("renders each comment with its effective status (perComment overrides comment.status)", () => {
    const comments = [comment("c1", "make bigger", "queued"), comment("c2", "fix color", "open")];
    render(<ProgressPanel status={status({ state: "applying", perComment: { c1: "applying" } })} comments={comments} />);

    expect(screen.getByText("make bigger")).toBeInTheDocument();
    expect(screen.getByText("fix color")).toBeInTheDocument();
    // c1 overridden to applying → 처리중, c2 falls back to its own status (open) → 대기
    expect(screen.getByText("처리중")).toBeInTheDocument();
    expect(screen.getByText("대기")).toBeInTheDocument();
  });
});
