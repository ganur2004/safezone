/**
 * Bottom bar: the last few turns, the microphone and the text input (SPEC 8.1).
 * The button walks idle → listening → thinking → speaking, with the glowing ring
 * that makes it feel like an Alexa device (SPEC 8.2).
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { isSpeechRecognitionSupported, listen, stopSpeaking } from "../voice/speech.js";

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
  onStateChange: (state: AssistantState) => void;
}

const LABELS: Record<AssistantState, string> = {
  idle: "Hold to speak, or type your question",
  listening: "Listening…",
  thinking: "Checking the data…",
  speaking: "Speaking…",
};

export function ChatBar({
  messages,
  state,
  presets,
  onAsk,
  onStateChange,
}: ChatBarProps): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [voiceError, setVoiceError] = useState<string | undefined>();
  const stopListening = useRef<(() => void) | undefined>(undefined);
  // Constant for the session, but it may only be read in the browser, so it is
  // state rather than a ref: a ref cannot be read during render.
  const [supported] = useState(isSpeechRecognitionSupported);
  const busy = state === "thinking";

  useEffect(() => () => stopListening.current?.(), []);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const question = draft.trim();
    if (!question || busy) return;
    setDraft("");
    onAsk(question);
  };

  const startListening = useCallback(() => {
    if (busy || state === "listening") return;
    setVoiceError(undefined);
    stopSpeaking();
    const stop = listen({
      // Show the words as they are recognised, so the user can see it working.
      onPartial: setDraft,
      onResult: (text) => {
        setDraft("");
        onAsk(text);
      },
      onError: (message) => {
        setVoiceError(message);
        setDraft("");
      },
      onEnd: () => {
        stopListening.current = undefined;
        onStateChange("idle");
      },
    });
    if (!stop) {
      setVoiceError("This browser has no speech recognition. Chrome works; typing always works.");
      return;
    }
    stopListening.current = stop;
    onStateChange("listening");
  }, [busy, onAsk, onStateChange, state]);

  const stop = useCallback(() => {
    stopListening.current?.();
    stopListening.current = undefined;
  }, []);

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
        {voiceError ? <p className="bubble error">{voiceError}</p> : null}
      </div>

      <form className="controls" onSubmit={submit}>
        <button
          type="button"
          className={`mic mic-${state}`}
          // Hold to talk on the desktop, tap-and-hold on a phone.
          onMouseDown={startListening}
          onMouseUp={stop}
          onMouseLeave={stop}
          onTouchStart={(event) => {
            event.preventDefault();
            startListening();
          }}
          onTouchEnd={stop}
          title={
            supported ? "Hold to speak" : "This browser has no speech recognition — type instead"
          }
          aria-label={supported ? "Hold to speak" : "Speech recognition unavailable"}
          disabled={busy || !supported}
        >
          🎤
        </button>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={LABELS[state]}
          aria-label="Ask a question"
          disabled={busy || state === "listening"}
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
