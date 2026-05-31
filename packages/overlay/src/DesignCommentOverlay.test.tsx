import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DesignCommentOverlay } from "./DesignCommentOverlay";
import type { BridgeClient } from "./client";
import type { Comment, CommentStatus, Question, Status } from "./types";

const idle: Status = { state: "idle", currentStep: null, perComment: {}, updatedAt: "t" };

function comment(id: string, text: string, status: CommentStatus = "open"): Comment {
  return {
    id, comment: text, status, url: "", selector: "", text: "", tag: "", classes: "",
    component: null, source: null, rect: null, createdAt: "t",
  };
}

function fakeClient(over: Partial<BridgeClient> = {}): BridgeClient {
  return {
    listComments: async () => [],
    addComment: async (i) => comment("new", i.comment),
    patchComment: async (id) => comment(id, "x", "resolved"),
    deleteComment: async () => {},
    clearComments: async () => {},
    apply: async () => ({ requestedAt: "t", origin: "local", ids: [] }),
    getStatus: async () => idle,
    setStatus: async () => idle,
    getQuestion: async () => null,
    currentQuestion: async () => null,
    answer: async () => ({ id: "q", text: "", options: [], status: "answered", answer: "", askedAt: "t" }),
    cancel: async () => ({ id: "q", text: "", options: [], status: "cancelled", answer: null, askedAt: "t" }),
    ...over,
  };
}

const pendingQ: Question = {
  id: "q1", text: "Which color?", options: ["blue", "red"], status: "pending", answer: null, askedAt: "t",
};

describe("DesignCommentOverlay", () => {
  it("renders the comment FAB", () => {
    render(<DesignCommentOverlay client={fakeClient()} />);
    expect(screen.getByRole("button", { name: /코멘트/ })).toBeInTheDocument();
  });

  it("shows the web-ask modal for a pending question and answers via the client", async () => {
    const answer = vi.fn(async () => pendingQ);
    render(<DesignCommentOverlay client={fakeClient({ getQuestion: async () => pendingQ, answer })} pollMs={10} />);
    expect(await screen.findByText("Which color?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "blue" }));
    expect(answer).toHaveBeenCalledWith("q1", "blue");
  });

  it("shows progress (current step + comment) while a run is applying", async () => {
    const client = fakeClient({
      getStatus: async () => ({ state: "applying", currentStep: "fixing header", perComment: {}, updatedAt: "t" }),
      listComments: async () => [comment("c1", "make bigger", "applying")],
    });
    render(<DesignCommentOverlay client={client} pollMs={10} />);
    expect(await screen.findByText(/fixing header/)).toBeInTheDocument();
    expect(await screen.findByText("make bigger")).toBeInTheDocument();
  });
});
