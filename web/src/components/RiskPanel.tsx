/** The side panel: risk level, factors, recommendations, sources (SPEC 8.1). */
import type { SafetyToolResult, Severity } from "@safezone/shared";
import { SEVERITY_COLORS } from "../map/layers.js";
import { isPlacementOnly } from "../agent/client.js";

/** One tool answer, with the tool that produced it. */
export interface PanelEntry {
  tool: string;
  result: SafetyToolResult;
}

export interface RiskPanelProps {
  severity: Severity;
  entries: PanelEntry[];
  place: string | undefined;
  collapsed: boolean;
  onToggle: () => void;
}

const SEVERITY_LABELS: Record<Severity, string> = {
  none: "NO ACTIVE HAZARDS",
  low: "LOW",
  moderate: "MODERATE",
  high: "HIGH",
  extreme: "EXTREME",
};

export function RiskPanel({
  severity,
  entries,
  place,
  collapsed,
  onToggle,
}: RiskPanelProps): React.JSX.Element {
  const results = entries.map((entry) => entry.result);
  const factors = collectFactors(entries);
  const recommendations = [
    ...new Set(
      results.flatMap((result) => {
        const list = result.data.recommendations;
        return Array.isArray(list) ? list.map(String) : [];
      }),
    ),
  ];
  const sources = dedupeSources(results);

  return (
    <aside className={`panel${collapsed ? " panel-collapsed" : ""}`}>
      <button className="panel-toggle" onClick={onToggle} aria-expanded={!collapsed}>
        {collapsed ? `${SEVERITY_LABELS[severity]} · details ▲` : "Hide ▼"}
      </button>

      <div className="panel-body">
        <div
          className={`risk${severity === "extreme" ? " risk-extreme" : ""}`}
          style={{ borderColor: SEVERITY_COLORS[severity] }}
        >
          <span className="risk-label">Risk</span>
          <strong style={{ color: SEVERITY_COLORS[severity] }}>{SEVERITY_LABELS[severity]}</strong>
          {place ? <span className="risk-place">{place}</span> : null}
        </div>

        {results.length === 0 ? (
          <p className="panel-empty">
            Ask about a place to see what is happening around it. Try one of the suggested
            questions.
          </p>
        ) : null}

        {factors.length > 0 ? (
          <section>
            <h3>Factors</h3>
            <ul className="factors">
              {factors.map((factor, index) => (
                <li key={`${factor.title}-${index}`}>
                  <span
                    className="dot"
                    style={{ background: SEVERITY_COLORS[factor.severity] }}
                    aria-hidden="true"
                  />
                  <span>{factor.title}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {recommendations.length > 0 ? (
          <section>
            <h3>Recommendations</h3>
            <ul className="recommendations">
              {recommendations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {sources.length > 0 ? (
          <section>
            <h3>Sources</h3>
            <ul className="sources">
              {sources.map((source) => (
                <li key={source.name}>
                  <a href={source.url} target="_blank" rel="noreferrer noopener">
                    {source.name}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="disclaimer">
          Demonstration project. Not a substitute for official emergency services — in an emergency
          call 911 and follow the instructions of local authorities.
        </p>
      </div>
    </aside>
  );
}

interface PanelFactor {
  title: string;
  severity: Severity;
}

/** Which risk source a narrow tool speaks for, so assess_risk can supersede it. */
const TOOL_SOURCE: Record<string, string> = {
  get_fire_hotspots: "fire",
  get_weather_alerts: "alert",
  get_air_quality: "air",
  get_earthquakes: "quake",
};

/**
 * assess_risk already reasoned about the hazards, so its factor list leads. A
 * narrow tool adds its own summary only when assess_risk did not already report
 * that source — otherwise the same fire would be listed twice, once as a
 * reasoned factor and once as the raw tool answer.
 */
function collectFactors(entries: PanelEntry[]): PanelFactor[] {
  const factors: PanelFactor[] = [];
  const seen = new Set<string>();
  const coveredSources = new Set<string>();
  const add = (title: string, severity: Severity): void => {
    if (seen.has(title)) return;
    seen.add(title);
    factors.push({ title, severity });
  };

  const assessments = entries.filter((entry) => Array.isArray(entry.result.data.factors));
  for (const { result } of assessments) {
    for (const candidate of result.data.factors as unknown[]) {
      const factor = candidate as { title?: unknown; severity?: unknown; source?: unknown };
      if (typeof factor.title !== "string") continue;
      add(factor.title, (factor.severity as Severity) ?? "none");
      if (typeof factor.source === "string") coveredSources.add(factor.source);
    }
  }

  for (const { tool, result } of entries) {
    // The geocode answer is shown as the place under the risk level, not as a factor.
    if (isPlacementOnly(result)) continue;
    // An assessment's own summary is already represented by its factors.
    if (Array.isArray(result.data.factors)) continue;
    const source = TOOL_SOURCE[tool];
    if (source && coveredSources.has(source)) continue;
    add(result.summary, result.severity ?? "none");
  }
  return factors;
}

function dedupeSources(results: SafetyToolResult[]): { name: string; url: string }[] {
  const seen = new Map<string, { name: string; url: string }>();
  for (const result of results) {
    for (const source of result.sources) {
      if (!seen.has(source.name)) seen.set(source.name, { name: source.name, url: source.url });
    }
  }
  return [...seen.values()];
}
