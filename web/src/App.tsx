/**
 * The simulator shell (SPEC 8): a full-screen map, the risk panel, and the chat
 * bar. Until M4 the browser talks to the MCP server directly through a small
 * keyword router (see mcp/router.ts).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapLayer, MapView, SafetyToolResult } from "@safezone/shared";
import { McpClient, McpError } from "./mcp/client.js";
import { PRESETS, ask, worstSeverity, type RouterState } from "./mcp/router.js";
import { MapCanvas } from "./map/MapCanvas.js";
import { ChatBar, type AssistantState, type Message } from "./components/ChatBar.js";
import { Legend } from "./components/Legend.js";
import { RiskPanel } from "./components/RiskPanel.js";

const MCP_URL = (import.meta.env.VITE_MCP_URL as string | undefined) ?? "http://localhost:8787/mcp";

export function App(): React.JSX.Element {
  const client = useMemo(() => new McpClient(MCP_URL), []);
  const router = useRef<RouterState>({ fireClusters: [] });

  const [messages, setMessages] = useState<Message[]>([]);
  const [state, setState] = useState<AssistantState>("idle");
  const [layers, setLayers] = useState<MapLayer[]>([]);
  const [view, setView] = useState<MapView | undefined>();
  // Factors accumulate per place, keyed by the tool that produced them: a
  // follow-up about the wind must not wipe the fire that is still burning.
  const [factors, setFactors] = useState<Map<string, SafetyToolResult>>(new Map());
  const [place, setPlace] = useState<string | undefined>();
  const [demo, setDemo] = useState(false);
  const [connection, setConnection] = useState<string | undefined>();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    client
      .initialize()
      .then((info) => setConnection(`${info.serverInfo.name} · MCP ${info.protocolVersion}`))
      .catch(() => setConnection(undefined));
  }, [client]);

  const onAsk = useCallback(
    async (question: string) => {
      setMessages((previous) => [...previous, { role: "user", text: question }]);
      setState("thinking");
      try {
        const { turn, state: nextRouterState } = await ask(client, question, router.current);
        router.current = nextRouterState;
        const results = turn.outcomes.map((outcome) => outcome.result);

        // Replace layers with the same id, keep the rest, so the map accumulates
        // context across a conversation (SPEC 8.3).
        const incoming = results.flatMap((result) => result.map?.layers ?? []);
        setLayers((previous) => mergeLayers(turn.placeChanged ? [] : previous, incoming));
        const lastView = [...results].reverse().find((result) => result.map?.view)?.map?.view;
        if (lastView) setView(lastView);

        setFactors((previous) => {
          const merged = turn.placeChanged
            ? new Map<string, SafetyToolResult>()
            : new Map(previous);
          for (const outcome of turn.outcomes) merged.set(outcome.tool, outcome.result);
          return merged;
        });
        setPlace(turn.place?.label);
        setDemo(results.some((result) => result.demo === true));
        setMessages((previous) => [...previous, { role: "assistant", text: turn.reply }]);
      } catch (error) {
        const text =
          error instanceof McpError || error instanceof Error
            ? error.message
            : "Something went wrong.";
        setMessages((previous) => [...previous, { role: "assistant", text, error: true }]);
      } finally {
        setState("idle");
      }
    },
    [client],
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
          <span className={`badge ${connection ? "online" : "offline"}`}>
            {connection ?? "server offline"}
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

      <ChatBar messages={messages} state={state} presets={PRESETS} onAsk={onAsk} />
    </div>
  );
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
