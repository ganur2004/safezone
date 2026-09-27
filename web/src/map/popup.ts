/** Popup contents for a clicked feature: the details plus where they came from (SPEC 8.3). */
import type { MapLayerKind } from "@safezone/shared";

type Properties = Record<string, unknown>;

const escapeHtml = (value: unknown): string =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );

/** Both units, using the pair the server sent so the popup cannot disagree with it. */
const distance = (properties: Properties): string | undefined => {
  const km = Number(properties.distance_km);
  if (!Number.isFinite(km)) return undefined;
  const miles = Number(properties.distance_mi);
  return Number.isFinite(miles) ? `${km} km (${miles} mi)` : `${km} km`;
};

const row = (label: string, value: unknown): string =>
  value === undefined || value === null || value === ""
    ? ""
    : `<div class="popup-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;

const TITLES: Record<MapLayerKind, string> = {
  home: "Your location",
  fires: "Fire hotspot",
  alerts: "Official alert",
  quakes: "Earthquake",
  air: "Air quality",
  wind: "Wind",
  places: "Safe place",
  route: "Route",
  radius: "Search radius",
};

export function popupHtml(kind: MapLayerKind, properties: Properties): string {
  const title = escapeHtml(
    properties.name ?? properties.event ?? properties.label ?? TITLES[kind] ?? kind,
  );
  const rows = detailRows(kind, properties);
  const source = properties.source
    ? `<div class="popup-source">${escapeHtml(properties.source)}</div>`
    : "";
  return `<div class="popup"><h4>${title}</h4>${rows}${source}</div>`;
}

function detailRows(kind: MapLayerKind, properties: Properties): string {
  switch (kind) {
    case "fires":
      return (
        row("Distance", distance(properties)) +
        row("Direction", properties.direction) +
        row("Radiative power", properties.frp ? `${properties.frp} MW` : undefined) +
        row("Detected", properties.acquired_at)
      );
    case "alerts":
      return (
        row("Severity", properties.nws_severity ?? properties.severity) +
        row("Area", properties.area) +
        row("Expires", properties.expires) +
        (properties.headline ? `<p class="popup-text">${escapeHtml(properties.headline)}</p>` : "")
      );
    case "quakes":
      return (
        row("Magnitude", properties.magnitude) +
        row("Place", properties.place) +
        row("Depth", withUnits(properties.depth_km)) +
        row("Distance", distance(properties)) +
        row("Time", properties.time)
      );
    case "air":
      return (
        row("US AQI", properties.us_aqi) +
        row("Category", properties.category) +
        row("PM2.5", properties.pm2_5 ? `${properties.pm2_5} µg/m³` : undefined) +
        row("Observed", properties.observed_at)
      );
    case "wind":
      return (
        row("Speed", properties.speed_kmh ? `${properties.speed_kmh} km/h` : undefined) +
        row("Gusts", properties.gusts_kmh ? `${properties.gusts_kmh} km/h` : undefined) +
        row("Coming from", properties.from_direction) +
        row("Blowing towards", properties.to_direction)
      );
    case "places":
      return (
        row("Type", String(properties.type ?? "").replace(/_/g, " ")) +
        row("Distance", distance(properties)) +
        row("Direction", properties.direction) +
        (properties.towards_danger === true
          ? `<p class="popup-text">This one lies towards the hazard.</p>`
          : "")
      );
    default:
      return row("Radius", withUnits(properties.radius_km));
  }
}

/** Both units, as everywhere else in the product (SPEC 5.2). */
function withUnits(km: unknown): string | undefined {
  const value = Number(km);
  if (!Number.isFinite(value)) return undefined;
  const miles = value * 0.621371;
  const round = (n: number): number => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
  return `${round(value)} km (${round(miles)} mi)`;
}
