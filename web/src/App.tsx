/**
 * The simulator shell (SPEC 8). Since M4 the browser holds no tool logic: it
 * posts the conversation to the agent service and draws whatever comes back.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapLayer, MapView, SafetyToolResult, Severity } from "@safezone/shared";
import { SEVERITY_ORDER } from "@safezone/shared";
import {
  AgentClient,
  AgentError,
  PRESETS,
  type AgentHealth,
  type ChatMessage,
} from "./agent/client.js";
import { speak, stopSpeaking } from "./voice/speech.js";
import { MapCanvas } from "./map/MapCanvas.js";
import { ChatBar, type AssistantState, type Message } from "./components/ChatBar.js";
import { Legend } from "./components/Legend.js";
import { RiskPanel } from "./components/RiskPanel.js";

const AGENT_URL = (import.meta.env.VITE_AGENT_URL as string | undefined) ?? "http://localhost:8788";

export function App(): React.JSX.Element {
  const client = useMemo(() => new AgentClient(AGENT_URL), []);
  /** The conversation as the agent sees it; the agent itself is stateless. */
  const history = useRef<ChatMessage[]>([]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [state, setState] = useState<AssistantState>("idle");
  const [layers, setLayers] = useState<MapLayer[]>([]);
  const [view, setView] = useState<MapView | undefined>();
  // Factors accumulate per tool: a follow-up about the wind must not wipe the
  // fire that is still burning.
  const [factors, setFactors] = useState<Map<string, SafetyToolResult>>(new Map());
  const [place, setPlace] = useState<string | undefined>();
  const [demo, setDemo] = useState(false);
  const [health, setHealth] = useState<AgentHealth | undefined>();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    client
      .health()
      .then(setHealth)
      .catch(() => setHealth(undefined));
  }, [client]);

  useEffect(() => stopSpeaking, []);

  const onAsk = useCallback(
    async (question: string) => {
      stopSpeaking();
      setMessages((previous) => [...previous, { role: "user", text: question }]);
      history.current = [...history.current, { role: "user", content: question }];
      setState("thinking");
      try {
        const reply = await client.chat(history.current);
        history.current = [...history.current, { role: "assistant", content: reply.reply }];

        // Same layer id replaces, everything else stays, so the map keeps the
        // context of the conversation (SPEC 8.3).
        const incoming = reply.toolResults.flatMap((result) => result.map?.layers ?? []);
        const home = reply.toolResults.find((result) =>
          result.map?.layers.some((layer) => layer.kind === "home"),
        );
        const movedTo = home?.data.label === undefined ? undefined : String(home.data.label);
        const placeChanged = movedTo !== undefined && movedTo !== place;

        setLayers((previous) => mergeLayers(placeChanged ? [] : previous, incoming));
        const lastView = [...reply.toolResults].reverse().find((result) => result.map?.view)
          ?.map?.view;
        if (lastView) setView(lastView);

        setFactors((previous) => {
          const merged = placeChanged ? new Map<string, SafetyToolResult>() : new Map(previous);
          reply.toolResults.forEach((result, index) => {
            merged.set(reply.resultTools[index] ?? `result-${index}`, result);
          });
          return merged;
        });
        if (movedTo) setPlace(movedTo);
        setDemo(reply.toolResults.some((result) => result.demo === true));
        setMessages((previous) => [...previous, { role: "assistant", text: reply.reply }]);

        // Speak the answer: Polly when the agent offers it, the browser voice otherwise.
        if (reply.reply) {
          setState("speaking");
          const audio = await client.speech(reply.reply).catch(() => undefined);
          await speak(reply.reply, audio);
        }
      } catch (error) {
        const text =
          error instanceof AgentError || error instanceof Error
            ? error.message
            : "Something went wrong.";
        setMessages((previous) => [...previous, { role: "assistant", text, error: true }]);
      } finally {
        setState("idle");
      }
    },
    [client, place],
  );

  const results = useMemo(() => [...factors.values()], [factors]);
  const severity = useMemo(() => worstSeverity(results), [results]);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          Safe<b>Zone</b>
        </span>
        <span className="tagline">voice safety assistant · simulator</span>
        <span className="badges">
          {demo ? <span className="badge demo">DEMO DATA</span> : null}
          <span className={`badge ${health ? "online" : "offline"}`}>
            {health ? `agent · ${health.mode} · ${health.tts} voice` : "agent offline"}
          </span>
        </span>
      </header>

      <main className="stage">
        <MapCanvas layers={layers} view={view} />
        <Legend layers={layers} />
        <RiskPanel
          severity={severity}
          results={results}
          place={place}
          collapsed={collapsed}
          onToggle={() => setCollapsed((value) => !value)}
        />
      </main>

      <ChatBar
        messages={messages}
        state={state}
        presets={PRESETS}
        onAsk={onAsk}
        onStateChange={setState}
      />
    </div>
  );
}

function worstSeverity(results: SafetyToolResult[]): Severity {
  return results.reduce<Severity>((worst, result) => {
    const severity = result.severity ?? "none";
    return SEVERITY_ORDER[severity] > SEVERITY_ORDER[worst] ? severity : worst;
  }, "none");
}

/** Same id replaces, everything else is kept in place. */
function mergeLayers(current: MapLayer[], incoming: MapLayer[]): MapLayer[] {
  if (incoming.length === 0) return current;
  const merged = [...current];
  for (const layer of incoming) {
    const index = merged.findIndex((existing) => existing.id === layer.id);
    if (index >= 0) merged[index] = layer;
    else merged.push(layer);
  }
  return merged;
}
