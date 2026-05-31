import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WebAskModal } from "./WebAskModal";
import type { Question } from "./types";

const q: Question = {
  id: "q1",
  text: "Which color?",
  options: ["blue", "red"],
  status: "pending",
  answer: null,
  askedAt: "t",
};

describe("WebAskModal", () => {
  it("renders the question text and an option button per option", () => {
    render(<WebAskModal question={q} onAnswer={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Which color?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "blue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "red" })).toBeInTheDocument();
  });

  it("calls onAnswer with the option label when an option is clicked", async () => {
    const onAnswer = vi.fn();
    render(<WebAskModal question={q} onAnswer={onAnswer} onCancel={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "blue" }));
    expect(onAnswer).toHaveBeenCalledWith("blue");
  });

  it("submits free-text input via onAnswer", async () => {
    const onAnswer = vi.fn();
    render(<WebAskModal question={{ ...q, options: [] }} onAnswer={onAnswer} onCancel={() => {}} />);
    await userEvent.type(screen.getByRole("textbox"), "custom answer");
    await userEvent.click(screen.getByRole("button", { name: /보내기/ }));
    expect(onAnswer).toHaveBeenCalledWith("custom answer");
  });

  it("does not submit empty free-text", async () => {
    const onAnswer = vi.fn();
    render(<WebAskModal question={{ ...q, options: [] }} onAnswer={onAnswer} onCancel={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /보내기/ }));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("calls onCancel when cancel is clicked", async () => {
    const onCancel = vi.fn();
    render(<WebAskModal question={q} onAnswer={() => {}} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: /취소/ }));
    expect(onCancel).toHaveBeenCalled();
  });
});
