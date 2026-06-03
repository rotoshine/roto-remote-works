import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DesignCommentOverlay } from "./DesignCommentOverlay";
import type { BridgeClient } from "./client";
import type { Comment, CommentStatus, Question, Status } from "./types";

const idle: Status = { state: "idle", currentStep: null, perComment: {}, result: null, updatedAt: "t" };

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

  it("lists comments with status badges, including resolved ones", async () => {
    const client = fakeClient({
      listComments: async () => [comment("c1", "열림 코멘트", "open"), comment("c2", "완료된 코멘트", "resolved")],
    });
    render(<DesignCommentOverlay client={client} pollMs={10} />);
    await userEvent.click(screen.getByRole("button", { name: /코멘트/ })); // open the panel
    expect(await screen.findByText("열림 코멘트")).toBeInTheDocument();
    expect(await screen.findByText("완료된 코멘트")).toBeInTheDocument();
    expect(document.querySelector('[data-status="resolved"]')).toBeTruthy();
    expect(document.querySelector('[data-status="open"]')).toBeTruthy();
  });

  it("shows an inspector-style highlight over the hovered element while selecting", async () => {
    const target = document.createElement("div");
    target.textContent = "hover me";
    document.body.appendChild(target);
    target.getBoundingClientRect = () =>
      ({ x: 10, y: 20, width: 100, height: 40, top: 20, left: 10, right: 110, bottom: 60, toJSON() {} }) as DOMRect;
    const orig = document.elementFromPoint;
    document.elementFromPoint = () => target;
    try {
      render(<DesignCommentOverlay client={fakeClient()} />);
      // not selecting yet → no highlight
      expect(document.querySelector("[data-rrw-highlight]")).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: /코멘트/ })); // enter selecting mode
      fireEvent.mouseMove(target, { clientX: 50, clientY: 30 });
      const hl = document.querySelector("[data-rrw-highlight]") as HTMLElement | null;
      expect(hl).not.toBeNull();
      expect(hl!.style.left).toBe("10px");
      expect(hl!.style.top).toBe("20px");
      expect(hl!.style.width).toBe("100px");
      expect(hl!.style.height).toBe("40px");
    } finally {
      document.elementFromPoint = orig;
      target.remove();
    }
  });

  it("shows a result banner with the PR link when an apply result is present", async () => {
    const client = fakeClient({
      getStatus: async () => ({
        state: "done",
        currentStep: null,
        perComment: {},
        result: { ok: true, prUrl: "https://github.com/o/r/pull/12", summary: "2 코멘트 적용", at: "t" },
        updatedAt: "t",
      }),
    });
    render(<DesignCommentOverlay client={client} pollMs={10} />);
    expect(await screen.findByText(/2 코멘트 적용/)).toBeInTheDocument();
    const link = await screen.findByRole("link", { name: /PR/ });
    expect(link).toHaveAttribute("href", "https://github.com/o/r/pull/12");
  });

  it("shows progress (current step + comment) while a run is applying", async () => {
    const client = fakeClient({
      getStatus: async () => ({ state: "applying", currentStep: "fixing header", perComment: {}, result: null, updatedAt: "t" }),
      listComments: async () => [comment("c1", "make bigger", "applying")],
    });
    render(<DesignCommentOverlay client={client} pollMs={10} />);
    expect(await screen.findByText(/fixing header/)).toBeInTheDocument();
    expect(await screen.findByText("make bigger")).toBeInTheDocument();
  });
});
