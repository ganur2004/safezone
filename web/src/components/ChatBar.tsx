/**
 * Bottom bar: the last few turns, the microphone button and the text input
 * (SPEC 8.1). Voice input itself arrives in M4; the button already carries the
 * idle → listening → thinking → speaking states so the styling is in place.
 */
import { useState, type FormEvent } from "react";

export type AssistantState = "idle" | "listening" | "thinking" | "speaking";

export interface Message {
  role: "user" | "assistant";
  text: string;
  error?: boolean;
}

export interface ChatBarProps {
  messages: Message[];
  state: AssistantState;
  presets: readonly string[];
  onAsk: (question: string) => void;
}

export function ChatBar({ messages, state, presets, onAsk }: ChatBarProps): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const busy = state === "thinking";

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const question = draft.trim();
    if (!question || busy) return;
    setDraft("");
    onAsk(question);
  };

  return (
    <div className="chatbar">
      <div className="transcript" aria-live="polite">
        {messages.slice(-3).map((message, index) => (
          <p
            key={`${message.role}-${index}-${message.text.slice(0, 12)}`}
            className={`bubble ${message.role}${message.error ? " error" : ""}`}
          >
            {message.text}
          </p>
        ))}
      </div>

      <form className="controls" onSubmit={submit}>
        <button
          type="button"
          className={`mic mic-${state}`}
          title="Voice input arrives in milestone M4"
          aria-label="Voice input, not available yet"
          disabled
        >
          🎤
        </button>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={busy ? "Working…" : "Ask whether a place is safe…"}
          aria-label="Ask a question"
          disabled={busy}
        />
        <button type="submit" className="send" disabled={busy || draft.trim().length === 0}>
          Ask
        </button>
      </form>

      <div className="presets">
        {presets.map((preset) => (
          <button key={preset} onClick={() => onAsk(preset)} disabled={busy}>
            {preset}
          </button>
        ))}
      </div>
    </div>
  );
}
