import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DesignCommentOverlay } from "./DesignCommentOverlay";
import type { BridgeClient } from "./client";
import type { Comment, CommentStatus, Question, Status } from "./types";
import type { GrabEngine, Grab } from "./grab-engine";

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

function fakeEngine() {
  let emit: ((g: Grab) => void) | undefined;
  const engine: GrabEngine = {
    activate: vi.fn(),
    deactivate: vi.fn(),
    onGrab: vi.fn((cb) => {
      emit = cb;
      return () => {
        emit = undefined;
      };
    }),
    dispose: vi.fn(),
  };
  const waitReady = () => vi.waitUntil(() => emit !== undefined);
  return { engine, waitReady, grab: (g: Grab) => emit?.(g) };
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

  it("places the comment draft on-screen even when clicking near the bottom-right edge", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    target.getBoundingClientRect = () =>
      ({ x: 1020, y: 760, width: 10, height: 10, top: 760, left: 1020, right: 1030, bottom: 770, toJSON() {} }) as DOMRect;
    try {
      const { engine, waitReady, grab } = fakeEngine();
      render(<DesignCommentOverlay client={fakeClient()} pollMs={0} grabEngineLoader={async () => engine} />);
      await userEvent.click(screen.getByRole("button", { name: /코멘트/ })); // selecting mode
      await waitFor(() => expect(engine.activate).toHaveBeenCalled());
      await waitReady();
      grab({ element: target, source: null, component: null });
      const card = await waitFor(() => {
        const el = document.querySelector(".rrw-draft") as HTMLElement | null;
        expect(el).not.toBeNull();
        return el!;
      });
      const left = parseInt(card.style.left, 10);
      const top = parseInt(card.style.top, 10);
      expect(left).toBeLessThanOrEqual(1024 - 288 - 12); // 724
      expect(left).toBeGreaterThanOrEqual(12);
      expect(top).toBeLessThanOrEqual(768 - 200 - 12); // 556
    } finally {
      target.remove();
    }
  });

  it("lets the draft card be dragged by its handle", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    target.getBoundingClientRect = () =>
      ({ x: 300, y: 300, width: 50, height: 20, top: 300, left: 300, right: 350, bottom: 320, toJSON() {} }) as DOMRect;
    try {
      const { engine, waitReady, grab } = fakeEngine();
      render(<DesignCommentOverlay client={fakeClient()} pollMs={0} grabEngineLoader={async () => engine} />);
      await userEvent.click(screen.getByRole("button", { name: /코멘트/ }));
      await waitFor(() => expect(engine.activate).toHaveBeenCalled());
      await waitReady();
      grab({ element: target, source: null, component: null });
      const card = () => waitFor(() => {
        const el = document.querySelector(".rrw-draft") as HTMLElement;
        expect(el).not.toBeNull();
        return el;
      });
      const before = (await card()).style.left;
      const handle = document.querySelector(".rrw-draft-handle") as HTMLElement;
      fireEvent.mouseDown(handle, { clientX: 300, clientY: 300 });
      fireEvent.mouseMove(document, { clientX: 200, clientY: 300 }); // drag left 100px
      fireEvent.mouseUp(document);
      expect((await card()).style.left).not.toBe(before);
    } finally {
      target.remove();
    }
  });

  it("lists comments with status badges, including resolved ones", async () => {
    const { engine } = fakeEngine();
    const client = fakeClient({
      listComments: async () => [comment("c1", "열림 코멘트", "open"), comment("c2", "완료된 코멘트", "resolved")],
    });
    render(<DesignCommentOverlay client={client} pollMs={10} grabEngineLoader={async () => engine} />);
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
      const { engine } = fakeEngine();
      render(<DesignCommentOverlay client={fakeClient()} grabEngineLoader={async () => engine} />);
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

  it("activates the engine in selecting mode and opens a draft on grab", async () => {
    const { engine, waitReady, grab } = fakeEngine();
    render(<DesignCommentOverlay client={fakeClient()} pollMs={0} grabEngineLoader={async () => engine} />);
    fireEvent.click(screen.getByRole("button", { name: /코멘트/ }));
    await waitFor(() => expect(engine.activate).toHaveBeenCalled());
    await waitReady();

    const el = document.createElement("button");
    document.body.appendChild(el);
    grab({ element: el, source: "src/Button.tsx:12", component: "Button" });

    await waitFor(() => expect(screen.getByText(/<Button>/)).toBeInTheDocument());
  });

  it("ignores grabs on the overlay's own host", async () => {
    const { engine, waitReady, grab } = fakeEngine();
    render(<DesignCommentOverlay client={fakeClient()} pollMs={0} grabEngineLoader={async () => engine} />);
    fireEvent.click(screen.getByRole("button", { name: /코멘트/ }));
    await waitFor(() => expect(engine.activate).toHaveBeenCalled());
    await waitReady();

    const host = document.createElement("div");
    host.setAttribute("data-rrw-host", "");
    const inner = document.createElement("span");
    host.appendChild(inner);
    document.body.appendChild(host);
    grab({ element: inner, source: null, component: null });

    expect(screen.queryByPlaceholderText("이 요소 수정 요청…")).not.toBeInTheDocument();
  });

  it("deactivates on exit and disposes on unmount", async () => {
    const { engine, waitReady } = fakeEngine();
    const { unmount } = render(
      <DesignCommentOverlay client={fakeClient()} pollMs={0} grabEngineLoader={async () => engine} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /코멘트/ }));
    await waitFor(() => expect(engine.activate).toHaveBeenCalled());
    await waitReady();
    fireEvent.click(screen.getByRole("button", { name: /취소/ }));
    await waitFor(() => expect(engine.deactivate).toHaveBeenCalled());
    unmount();
    await waitFor(() => expect(engine.dispose).toHaveBeenCalled());
  });

  it("disposes even if unmounted while the engine is still loading", async () => {
    let resolve!: (e: GrabEngine) => void;
    const pending = new Promise<GrabEngine>((r) => (resolve = r));
    const { engine } = fakeEngine();
    const { unmount } = render(
      <DesignCommentOverlay client={fakeClient()} pollMs={0} grabEngineLoader={() => pending} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /코멘트/ }));
    unmount();
    resolve(engine);
    await waitFor(() => expect(engine.dispose).toHaveBeenCalled());
    expect(engine.onGrab).not.toHaveBeenCalled();
  });

  it("lets the comment panel be dragged by its header", async () => {
    const orig = document.elementFromPoint;
    document.elementFromPoint = (() => null) as typeof document.elementFromPoint; // selecting-mode hover no-op
    const { engine } = fakeEngine(); // avoid loading real react-grab (jsdom lacks elementsFromPoint)
    try {
      render(<DesignCommentOverlay client={fakeClient()} grabEngineLoader={async () => engine} />);
      await userEvent.click(screen.getByRole("button", { name: /코멘트/ })); // opens the panel
      const panel = () => document.querySelector(".rrw-panel") as HTMLElement;
      const before = panel().style.left;
      const handle = document.querySelector(".rrw-panel-head") as HTMLElement;
      fireEvent.mouseDown(handle, { clientX: 400, clientY: 400 });
      fireEvent.mouseMove(document, { clientX: 300, clientY: 350 }); // drag up-left
      fireEvent.mouseUp(document);
      expect(panel().style.left).not.toBe(before);
    } finally {
      document.elementFromPoint = orig;
    }
  });

  it("lets the progress dock be dragged by its grip", async () => {
    const client = fakeClient({
      getStatus: async () => ({ state: "applying", currentStep: "x", perComment: {}, result: null, updatedAt: "t" }),
      listComments: async () => [comment("c1", "make bigger", "applying")],
    });
    render(<DesignCommentOverlay client={client} pollMs={10} />);
    await screen.findByText("make bigger");
    const dock = () => document.querySelector(".rrw-dock") as HTMLElement;
    const before = dock().style.left;
    const handle = document.querySelector(".rrw-dock-handle") as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 200, clientY: 400 });
    fireEvent.mouseMove(document, { clientX: 350, clientY: 300 });
    fireEvent.mouseUp(document);
    expect(dock().style.left).not.toBe(before);
  });

  it("lets the result banner be dragged by its grip", async () => {
    const client = fakeClient({
      getStatus: async () => ({
        state: "done", currentStep: null, perComment: {},
        result: { ok: true, summary: "적용 완료", at: "t" }, updatedAt: "t",
      }),
    });
    render(<DesignCommentOverlay client={client} pollMs={10} />);
    await screen.findByText(/적용 완료/);
    const banner = () => document.querySelector(".rrw-result") as HTMLElement;
    const before = banner().style.left;
    const handle = document.querySelector(".rrw-result-handle") as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 600, clientY: 200 });
    fireEvent.mouseMove(document, { clientX: 500, clientY: 300 });
    fireEvent.mouseUp(document);
    expect(banner().style.left).not.toBe(before);
  });

  it("brings a panel to front (higher z-index) when it is dragged", async () => {
    const client = fakeClient({
      getStatus: async () => ({
        state: "done", currentStep: null, perComment: {},
        result: { ok: true, summary: "적용 완료", at: "t" }, updatedAt: "t",
      }),
    });
    const orig = document.elementFromPoint;
    document.elementFromPoint = (() => null) as typeof document.elementFromPoint;
    const { engine } = fakeEngine(); // avoid loading real react-grab (jsdom lacks elementsFromPoint)
    try {
      render(<DesignCommentOverlay client={client} pollMs={10} grabEngineLoader={async () => engine} />);
      await screen.findByText(/적용 완료/);
      await userEvent.click(screen.getByRole("button", { name: /코멘트/ })); // open panel too
      const panel = document.querySelector(".rrw-panel") as HTMLElement;
      const banner = document.querySelector(".rrw-result") as HTMLElement;

      fireEvent.mouseDown(document.querySelector(".rrw-panel-head") as HTMLElement, { clientX: 400, clientY: 400 });
      fireEvent.mouseUp(document);
      fireEvent.mouseDown(document.querySelector(".rrw-result-handle") as HTMLElement, { clientX: 600, clientY: 200 });
      fireEvent.mouseUp(document);

      expect(Number(banner.style.zIndex)).toBeGreaterThan(Number(panel.style.zIndex));
    } finally {
      document.elementFromPoint = orig;
    }
  });
});
