/** The side panel: risk level, factors, recommendations, sources (SPEC 8.1). */
import type { SafetyToolResult, Severity } from "@safezone/shared";
import { SEVERITY_COLORS } from "../map/layers.js";
import { isPlacementOnly } from "../mcp/router.js";

export interface RiskPanelProps {
  severity: Severity;
  results: SafetyToolResult[];
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
  results,
  place,
  collapsed,
  onToggle,
}: RiskPanelProps): React.JSX.Element {
  // The geocode answer is shown as the place under the risk level, not as a factor.
  const factors = results.filter((result) => !isPlacementOnly(result));
  const recommendations = results.flatMap((result) => {
    const list = result.data.recommendations;
    return Array.isArray(list) ? list.map(String) : [];
  });
  const sources = dedupeSources(results);

  return (
    <aside className={`panel${collapsed ? " panel-collapsed" : ""}`}>
      <button className="panel-toggle" onClick={onToggle} aria-expanded={!collapsed}>
        {collapsed ? "Details ▲" : "Hide ▼"}
      </button>

      <div className="panel-body">
        <div className="risk" style={{ borderColor: SEVERITY_COLORS[severity] }}>
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
              {factors.map((result, index) => (
                <li key={`${result.summary}-${index}`}>
                  <span
                    className="dot"
                    style={{ background: SEVERITY_COLORS[result.severity ?? "none"] }}
                    aria-hidden="true"
                  />
                  <span>{result.summary}</span>
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

function dedupeSources(results: SafetyToolResult[]): { name: string; url: string }[] {
  const seen = new Map<string, { name: string; url: string }>();
  for (const result of results) {
    for (const source of result.sources) {
      if (!seen.has(source.name)) seen.set(source.name, { name: source.name, url: source.url });
    }
  }
  return [...seen.values()];
}
