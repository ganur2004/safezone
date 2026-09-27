/**
 * Voice in and out for the simulator (SPEC 8.2).
 *
 * Input uses the Web Speech API, which only Chrome and Safari implement; where
 * it is missing the text box stays the way in. Output prefers Polly through the
 * agent and falls back to the browser's own speechSynthesis.
 */

/** Minimal typing for the vendor-prefixed API, which TypeScript's DOM lib omits. */
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function recognitionConstructor(): SpeechRecognitionConstructor | undefined {
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

export const isSpeechRecognitionSupported = (): boolean => recognitionConstructor() !== undefined;

export interface ListenHandlers {
  /** Fires as the user speaks, so the input box can show the words appearing. */
  onPartial?: (text: string) => void;
  onResult: (text: string) => void;
  onError: (message: string) => void;
  onEnd?: () => void;
}

/** Starts listening. Returns a stop function, or undefined if unsupported. */
export function listen(handlers: ListenHandlers): (() => void) | undefined {
  const Recognition = recognitionConstructor();
  if (!Recognition) return undefined;

  const recognition = new Recognition();
  recognition.lang = "en-US";
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let final = "";
  recognition.onresult = (event) => {
    let interim = "";
    for (let index = 0; index < event.results.length; index += 1) {
      const alternative = event.results[index]?.[0];
      if (!alternative) continue;
      if (event.results[index]?.isFinal) final += alternative.transcript;
      else interim += alternative.transcript;
    }
    handlers.onPartial?.((final + interim).trim());
  };
  recognition.onerror = (event) => {
    handlers.onError(describeError(event.error));
  };
  recognition.onend = () => {
    const text = final.trim();
    if (text) handlers.onResult(text);
    handlers.onEnd?.();
  };

  recognition.start();
  return () => recognition.stop();
}

function describeError(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "I need permission to use the microphone. You can still type your question.";
    case "no-speech":
      return "I did not catch that. Try again, or type your question.";
    case "audio-capture":
      return "I could not find a microphone. You can still type your question.";
    case "network":
      return "Speech recognition needs a network connection. You can still type your question.";
    default:
      return `Speech recognition failed (${code}). You can still type your question.`;
  }
}

let currentAudio: HTMLAudioElement | undefined;

/** Stops whatever is currently speaking, from either voice. */
export function stopSpeaking(): void {
  currentAudio?.pause();
  currentAudio = undefined;
  window.speechSynthesis?.cancel();
}

/**
 * Speaks `text`, preferring the Polly audio the agent returns. Resolves when the
 * audio finishes so the button can go back to idle.
 */
export async function speak(text: string, audio: Blob | undefined): Promise<void> {
  stopSpeaking();
  if (audio) {
    const url = URL.createObjectURL(audio);
    const element = new Audio(url);
    currentAudio = element;
    try {
      await new Promise<void>((resolve, reject) => {
        element.onended = () => resolve();
        element.onerror = () => reject(new Error("audio playback failed"));
        void element.play().catch(reject);
      });
      return;
    } catch {
      // Autoplay blocked or a decoding problem: fall through to the browser voice.
    } finally {
      URL.revokeObjectURL(url);
      currentAudio = undefined;
    }
  }
  await speakWithBrowser(text);
}

function speakWithBrowser(text: string): Promise<void> {
  const synthesis = window.speechSynthesis;
  if (!synthesis) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1.02;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    synthesis.speak(utterance);
  });
}
