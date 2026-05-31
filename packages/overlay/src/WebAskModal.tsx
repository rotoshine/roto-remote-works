import { useState } from "react";
import type { Question } from "./types";

export interface WebAskModalProps {
  question: Question;
  onAnswer: (value: string) => void;
  onCancel: () => void;
}

/** Shows a question from the Claude session and collects the answer in the web UI. */
export function WebAskModal({ question, onAnswer, onCancel }: WebAskModalProps) {
  const [text, setText] = useState("");

  const submit = () => {
    const v = text.trim();
    if (v) onAnswer(v);
  };

  return (
    <div className="rrw-card rrw-webask" role="dialog" aria-label="Claude question">
      <p className="rrw-webask-text">{question.text}</p>

      {question.options.length > 0 && (
        <div className="rrw-webask-options">
          {question.options.map((opt) => (
            <button
              key={opt}
              type="button"
              className="rrw-btn rrw-btn-primary"
              onClick={() => onAnswer(opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      <form
        className="rrw-webask-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          className="rrw-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="직접 입력…"
        />
        <button type="submit" className="rrw-btn rrw-btn-primary">
          보내기
        </button>
      </form>

      <button type="button" className="rrw-btn rrw-btn-ghost" onClick={onCancel}>
        취소
      </button>
    </div>
  );
}
