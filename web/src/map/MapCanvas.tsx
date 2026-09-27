/**
 * The map (SPEC 8.3). It owns one MapLibre instance and syncs it with whatever
 * layers the last tool results carried: replace the data of a source that exists,
 * create it otherwise, then fly to the requested view.
 */
import { useEffect, useRef } from "react";
// maplibre-gl v6 ships named exports only.
import {
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  type GeoJSONSource,
  type LngLatBoundsLike,
} from "maplibre-gl";
import type { MapLayer, MapView } from "@safezone/shared";
import "maplibre-gl/dist/maplibre-gl.css";
import { KIND_ORDER, LAYER_STYLES } from "./layers.js";
import { withArrowHeads } from "./arrow.js";
import { popupHtml } from "./popup.js";

/** Free dark basemap, no key needed. Override with VITE_MAP_STYLE_URL. */
const DEFAULT_STYLE = "https://tiles.openfreemap.org/styles/dark";
const FLY_DURATION_MS = 1500;

export interface MapCanvasProps {
  layers: MapLayer[];
  view: MapView | undefined;
  onReady?: () => void;
}

export function MapCanvas({ layers, view, onReady }: MapCanvasProps): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const ready = useRef(false);
  const pending = useRef<{ layers: MapLayer[]; view: MapView | undefined } | null>(null);

  useEffect(() => {
    if (!container.current || map.current) return;
    const instance = new MapLibreMap({
      container: container.current,
      style: (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) || DEFAULT_STYLE,
      center: [-98.5, 39.5], // the US, until the first answer arrives
      zoom: 3.2,
      attributionControl: { compact: true },
    });
    instance.addControl(new NavigationControl({ showCompass: false }), "top-left");
    instance.on("load", () => {
      ready.current = true;
      onReady?.();
      if (pending.current) {
        apply(instance, pending.current.layers, pending.current.view);
        pending.current = null;
      }
    });
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
      ready.current = false;
    };
    // Deliberately once: the map instance outlives prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    if (!ready.current) {
      pending.current = { layers, view };
      return;
    }
    apply(instance, layers, view);
  }, [layers, view]);

  return <div ref={container} className="map" aria-label="Hazard map" />;
}

function apply(map: MapLibreMap, layers: MapLayer[], view: MapView | undefined): void {
  const byKind = [...layers].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
  for (const layer of byKind) syncLayer(map, layer);
  if (view) flyTo(map, view);
}

function syncLayer(map: MapLibreMap, layer: MapLayer): void {
  const style = LAYER_STYLES[layer.kind];
  const data = layer.kind === "wind" ? withArrowHeads(layer.geojson) : layer.geojson;
  const existing = map.getSource(layer.id);

  if (existing) {
    (existing as GeoJSONSource).setData(data);
    return;
  }

  map.addSource(layer.id, { type: "geojson", data });
  for (const spec of style.layers(layer.id)) {
    if (!map.getLayer(spec.id)) map.addLayer(spec);
  }
  for (const interactiveId of style.interactive(layer.id)) {
    map.on("click", interactiveId, (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      new Popup({ closeButton: true, maxWidth: "280px" })
        .setLngLat(event.lngLat)
        .setHTML(popupHtml(layer.kind, feature.properties ?? {}))
        .addTo(map);
    });
    map.on("mouseenter", interactiveId, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", interactiveId, () => {
      map.getCanvas().style.cursor = "";
    });
  }
}

function flyTo(map: MapLibreMap, view: MapView): void {
  if (view.bbox) {
    const [west, south, east, north] = view.bbox;
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ] as LngLatBoundsLike,
      { duration: FLY_DURATION_MS, padding: { top: 80, bottom: 200, left: 80, right: 80 } },
    );
    return;
  }
  if (view.center) {
    map.flyTo({ center: view.center, zoom: view.zoom ?? 10, duration: FLY_DURATION_MS });
  }
}
