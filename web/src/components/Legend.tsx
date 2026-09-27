/**
 * Legend for the layers currently on the map (SPEC 8.3), and the switch for
 * turning one off — with five hazards drawn at once, being able to hide the
 * fires and look at the alert polygon underneath is the difference between a
 * map and a mess.
 */
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

export interface LegendProps {
  layers: MapLayer[];
  hidden: ReadonlySet<string>;
  onToggle: (layerId: string) => void;
}

export function Legend({ layers, hidden, onToggle }: LegendProps): React.JSX.Element | null {
  // One entry per kind; the id of the first layer of that kind does the toggling.
  const entries = new Map<MapLayerKind, string[]>();
  for (const layer of layers) {
    entries.set(layer.kind, [...(entries.get(layer.kind) ?? []), layer.id]);
  }
  if (entries.size === 0) return null;

  return (
    <div className="legend" role="group" aria-label="Map layers">
      {[...entries].map(([kind, ids]) => {
        const off = ids.every((id) => hidden.has(id));
        return (
          <button
            key={kind}
            type="button"
            className={`legend-item${off ? " legend-off" : ""}`}
            aria-pressed={!off}
            title={off ? `Show ${LAYER_STYLES[kind].label}` : `Hide ${LAYER_STYLES[kind].label}`}
            onClick={() => ids.forEach(onToggle)}
          >
            <i style={{ background: SWATCHES[kind] }} aria-hidden="true" />
            {LAYER_STYLES[kind].label}
          </button>
        );
      })}
    </div>
  );
}
