import { describe, it, expect, vi } from "vitest";
import { askQuestion } from "./ask";
import type { AgentClient } from "./client";
import type { Question, QuestionStatus } from "@rrw/bridge";

function q(id: string, status: QuestionStatus, answer: string | null = null): Question {
  return { id, text: "", options: [], status, answer, askedAt: "t" };
}

function fakeAgentClient(over: Partial<AgentClient>): AgentClient {
  return {
    listComments: async () => [],
    patchComment: async () => ({}) as never,
    getRequest: async () => null,
    clearRequest: async () => {},
    setStatus: async () => ({}) as never,
    postQuestion: async () => q("q1", "pending"),
    currentQuestion: async () => null,
    cancelQuestion: async () => null,
    getScreenshot: async () => null,
    ...over,
  };
}

describe("askQuestion", () => {
  it("resolves with the answer once the question is answered", async () => {
    let calls = 0;
    const client = fakeAgentClient({
      currentQuestion: async () => {
        calls += 1;
        return calls < 3 ? q("q1", "pending") : q("q1", "answered", "blue");
      },
    });
    const res = await askQuestion(client, "color?", {
      options: ["blue"],
      sleep: async () => {},
      now: () => 0,
    });
    expect(res).toEqual({ answered: true, answer: "blue" });
  });

  it("resolves as cancelled when the user cancels", async () => {
    const client = fakeAgentClient({ currentQuestion: async () => q("q1", "cancelled") });
    const res = await askQuestion(client, "x", { sleep: async () => {}, now: () => 0 });
    expect(res).toEqual({ answered: false, reason: "cancelled" });
  });

  it("times out (and cancels the question) when no answer arrives in time", async () => {
    let t = 0;
    const cancelQuestion = vi.fn(async () => null);
    const client = fakeAgentClient({
      currentQuestion: async () => q("q1", "pending"),
      cancelQuestion,
    });
    const res = await askQuestion(client, "x", {
      pollMs: 1,
      timeoutMs: 10,
      sleep: async () => {
        t += 5;
      },
      now: () => t,
    });
    expect(res).toEqual({ answered: false, reason: "timeout" });
    expect(cancelQuestion).toHaveBeenCalledWith("q1");
  });
});
