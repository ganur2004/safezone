/** Legend showing only the layers currently on the map (SPEC 8.3). */
import type { MapLayer, MapLayerKind } from "@safezone/shared";
import { LAYER_STYLES } from "../map/layers.js";

const SWATCHES: Record<MapLayerKind, string> = {
  home: "#5ac8fa",
  fires: "#ff6a3d",
  alerts: "#ffb020",
  quakes: "#b07bff",
  air: "#8fd14f",
  wind: "#5ac8fa",
  places: "#3ddc97",
  route: "#ffd166",
  radius: "rgba(234,246,255,0.6)",
};

export function Legend({ layers }: { layers: MapLayer[] }): React.JSX.Element | null {
  const kinds = [...new Set(layers.map((layer) => layer.kind))];
  if (kinds.length === 0) return null;
  return (
    <div className="legend">
      {kinds.map((kind) => (
        <span key={kind} className="legend-item">
          <i style={{ background: SWATCHES[kind] }} aria-hidden="true" />
          {LAYER_STYLES[kind].label}
        </span>
      ))}
    </div>
  );
}
