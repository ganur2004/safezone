/** Pure logic for `get_weather_alerts` (spec 5.3): severity mapping and phrasing. */
import { SEVERITY_ORDER, type Severity } from "@safezone/shared";
import type { NwsAlert } from "../sources/nws.js";

/** NWS severity vocabulary → our scale (spec 5.3). */
export function mapNwsSeverity(nwsSeverity: string): Severity {
  switch (nwsSeverity.toLowerCase()) {
    case "extreme":
      return "extreme";
    case "severe":
      return "high";
    case "moderate":
      return "moderate";
    case "minor":
      return "low";
    default:
      return "none"; // "Unknown"
  }
}

/** The worst severity among the alerts, "none" when there are none. */
export function worstSeverity(alerts: NwsAlert[]): Severity {
  return alerts.reduce<Severity>((worst, alert) => {
    const mapped = mapNwsSeverity(alert.severity);
    return SEVERITY_ORDER[mapped] > SEVERITY_ORDER[worst] ? mapped : worst;
  }, "none");
}

/** Most serious first, so the summary and the map legend lead with it. */
export function sortBySeverity(alerts: NwsAlert[]): NwsAlert[] {
  return [...alerts].sort(
    (a, b) =>
      SEVERITY_ORDER[mapNwsSeverity(b.severity)] - SEVERITY_ORDER[mapNwsSeverity(a.severity)],
  );
}

export function alertsSummary(alerts: NwsAlert[], covered: boolean): string {
  if (!covered) return "Official weather alerts are available for US locations only.";
  if (alerts.length === 0) return "No active official weather alerts for this location.";
  const sorted = sortBySeverity(alerts);
  const worst = sorted[0] as NwsAlert;
  const others = alerts.length - 1;
  const rest =
    others === 0
      ? ""
      : others === 1
        ? " One more alert is also active."
        : ` ${others} more alerts are also active.`;
  return `${worst.event} is in effect for this area.${rest}`;
}

/** First sentence of the official instruction, for the recommendations list. */
export function firstInstruction(alerts: NwsAlert[]): string | undefined {
  for (const alert of sortBySeverity(alerts)) {
    const instruction = alert.instruction.replace(/\s+/g, " ").trim();
    if (instruction) {
      const sentence = instruction.split(/(?<=\.)\s/)[0] ?? instruction;
      return sentence.length > 160 ? `${sentence.slice(0, 157)}...` : sentence;
    }
  }
  return undefined;
}
