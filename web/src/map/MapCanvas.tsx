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
  setWorkerUrl,
  type GeoJSONSource,
  type LngLatBoundsLike,
} from "maplibre-gl";
/*
 * MapLibre loads its worker from a URL it computes itself, which the dev server
 * resolves straight out of node_modules — so the map works locally while the
 * production build never emits the file, and the deployed site asks CloudFront
 * for a worker that is not there. `?worker&url` makes Vite bundle it (it is an
 * ES module that imports a sibling, so copying the file alone is not enough)
 * and hand back the hashed asset URL.
 */
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { MapLayer, MapView } from "@safezone/shared";
import "maplibre-gl/dist/maplibre-gl.css";
import { startAnimations } from "./animate.js";
import { KIND_ORDER, LAYER_STYLES } from "./layers.js";
import { withArrowHeads } from "./arrow.js";
import { popupHtml } from "./popup.js";

/** Free dark basemap, no key needed. Override with VITE_MAP_STYLE_URL. */
const DEFAULT_STYLE = "https://tiles.openfreemap.org/styles/dark";
const FLY_DURATION_MS = 1500;

export interface MapCanvasProps {
  layers: MapLayer[];
  view: MapView | undefined;
  /** Layer ids the viewer switched off in the legend. */
  hidden?: ReadonlySet<string>;
  onReady?: () => void;
}

setWorkerUrl(workerUrl);

export function MapCanvas({ layers, view, hidden, onReady }: MapCanvasProps): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const ready = useRef(false);
  const pending = useRef<{ layers: MapLayer[]; view: MapView | undefined } | null>(null);
  // One popup at a time: a second click should move the popup, not stack one.
  const popup = useRef<Popup | null>(null);

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
    let stopAnimations: (() => void) | undefined;
    instance.on("load", () => {
      ready.current = true;
      stopAnimations = startAnimations(instance);
      onReady?.();
      if (pending.current) {
        apply(instance, pending.current.layers, pending.current.view, popup);
        pending.current = null;
      }
    });
    map.current = instance;
    return () => {
      stopAnimations?.();
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
    // A new answer replaces the context the open popup described.
    popup.current?.remove();
    popup.current = null;
    apply(instance, layers, view, popup);
  }, [layers, view]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready.current) return;
    for (const layer of layers) {
      const style = LAYER_STYLES[layer.kind];
      const visibility = hidden?.has(layer.id) ? "none" : "visible";
      for (const spec of style.layers(layer.id)) {
        if (instance.getLayer(spec.id)) {
          instance.setLayoutProperty(spec.id, "visibility", visibility);
        }
      }
    }
  }, [layers, hidden]);

  return <div ref={container} className="map" aria-label="Hazard map" />;
}

function apply(
  map: MapLibreMap,
  layers: MapLayer[],
  view: MapView | undefined,
  popup: { current: Popup | null },
): void {
  const byKind = [...layers].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
  for (const layer of byKind) syncLayer(map, layer, popup);
  if (view) flyTo(map, view);
}

function syncLayer(map: MapLibreMap, layer: MapLayer, popup: { current: Popup | null }): void {
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
      popup.current?.remove();
      popup.current = new Popup({ closeButton: true, maxWidth: "280px" })
        .setLngLat(event.lngLat)
        .setHTML(popupHtml(layer.kind, feature.properties ?? {}))
        .addTo(map);
      popup.current.on("close", () => {
        popup.current = null;
      });
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
