/**
 * How each SafetyToolResult layer kind is drawn (SPEC 8.3).
 *
 * One source per layer id. On a new result the data is replaced with setData if
 * the source exists, so repeated questions do not pile up sources.
 */
import type { MapLayerKind, Severity } from "@safezone/shared";
import type { LayerSpecification } from "maplibre-gl";

export const SEVERITY_COLORS: Record<Severity, string> = {
  none: "#3ddc97",
  low: "#8fd14f",
  moderate: "#ffb020",
  high: "#ff6a3d",
  extreme: "#ff3b5c",
};

export interface LayerStyle {
  label: string;
  /** MapLibre layers added for this kind, in draw order. `SOURCE` is substituted. */
  layers: (id: string) => LayerSpecification[];
  /** Layer ids that answer clicks with a popup. */
  interactive: (id: string) => string[];
}

const circleHeat = (id: string): LayerSpecification[] => [
  {
    id: `${id}-heat`,
    type: "heatmap",
    source: id,
    // Fades in as you zoom out, so a big cluster still reads at a glance.
    maxzoom: 11,
    paint: {
      "heatmap-weight": ["interpolate", ["linear"], ["coalesce", ["get", "frp"], 1], 0, 0.2, 50, 1],
      "heatmap-intensity": 0.8,
      "heatmap-radius": 24,
      "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.7, 11, 0],
      "heatmap-color": [
        "interpolate",
        ["linear"],
        ["heatmap-density"],
        0,
        "rgba(0,0,0,0)",
        0.3,
        "rgba(255,176,32,0.5)",
        0.7,
        "rgba(255,106,61,0.75)",
        1,
        "rgba(255,59,92,0.9)",
      ],
    },
  },
  {
    id: `${id}-points`,
    type: "circle",
    source: id,
    paint: {
      // Radius by fire radiative power: a proxy for how much energy it is putting out.
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["coalesce", ["get", "frp"], 1],
        0,
        4,
        10,
        6,
        50,
        11,
        200,
        18,
      ],
      "circle-color": [
        "interpolate",
        ["linear"],
        ["coalesce", ["get", "frp"], 1],
        0,
        "#ffb020",
        30,
        "#ff6a3d",
        120,
        "#ff3b5c",
      ],
      "circle-opacity": 0.85,
      "circle-stroke-width": 1,
      "circle-stroke-color": "rgba(255,255,255,0.5)",
    },
  },
];

export const LAYER_STYLES: Record<MapLayerKind, LayerStyle> = {
  home: {
    label: "Your location",
    layers: (id) => [
      {
        id: `${id}-pulse`,
        type: "circle",
        source: id,
        paint: {
          "circle-radius": 8,
          "circle-color": "#5ac8fa",
          "circle-opacity": 0.25,
        },
      },
      {
        id: `${id}-dot`,
        type: "circle",
        source: id,
        paint: {
          "circle-radius": 6,
          "circle-color": "#5ac8fa",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#eaf6ff",
        },
      },
    ],
    interactive: (id) => [`${id}-dot`],
  },

  fires: {
    label: "Fire hotspots",
    layers: circleHeat,
    interactive: (id) => [`${id}-points`],
  },

  radius: {
    label: "Search radius",
    layers: (id) => [
      {
        id: `${id}-line`,
        type: "line",
        source: id,
        paint: {
          "line-color": "rgba(234,246,255,0.45)",
          "line-width": 1.5,
          "line-dasharray": [3, 3],
        },
      },
    ],
    interactive: () => [],
  },

  alerts: {
    label: "Official alerts",
    layers: (id) => [
      {
        id: `${id}-fill`,
        type: "fill",
        source: id,
        paint: {
          "fill-color": [
            "match",
            ["coalesce", ["get", "severity"], "moderate"],
            "extreme",
            SEVERITY_COLORS.extreme,
            "high",
            SEVERITY_COLORS.high,
            "moderate",
            SEVERITY_COLORS.moderate,
            "low",
            SEVERITY_COLORS.low,
            SEVERITY_COLORS.none,
          ],
          "fill-opacity": 0.22,
        },
      },
      {
        id: `${id}-outline`,
        type: "line",
        source: id,
        paint: {
          "line-color": [
            "match",
            ["coalesce", ["get", "severity"], "moderate"],
            "extreme",
            SEVERITY_COLORS.extreme,
            "high",
            SEVERITY_COLORS.high,
            "moderate",
            SEVERITY_COLORS.moderate,
            SEVERITY_COLORS.low,
          ],
          "line-width": 1.5,
        },
      },
    ],
    interactive: (id) => [`${id}-fill`],
  },

  quakes: {
    label: "Earthquakes",
    layers: (id) => [
      {
        id: `${id}-points`,
        type: "circle",
        source: id,
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "magnitude"], 1],
            2,
            4,
            5,
            12,
            7,
            22,
          ],
          "circle-color": "#b07bff",
          "circle-opacity": 0.35,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#d9c2ff",
        },
      },
    ],
    interactive: (id) => [`${id}-points`],
  },

  air: {
    label: "Air quality",
    layers: (id) => [
      {
        id: `${id}-badge`,
        type: "circle",
        source: id,
        paint: {
          "circle-radius": 14,
          "circle-color": ["coalesce", ["get", "color"], "#8fd14f"],
          "circle-opacity": 0.75,
          "circle-stroke-width": 2,
          "circle-stroke-color": "rgba(10,14,20,0.8)",
          // The reading is for the same point as the home marker, so shift the
          // badge clear of it instead of stacking the two.
          "circle-translate": [0, -34],
        },
      },
      {
        id: `${id}-value`,
        type: "symbol",
        source: id,
        layout: {
          "text-field": ["to-string", ["coalesce", ["get", "us_aqi"], "?"]],
          "text-size": 12,
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#0a0e14", "text-translate": [0, -34] },
      },
    ],
    interactive: (id) => [`${id}-badge`],
  },

  wind: {
    label: "Wind",
    layers: (id) => [
      {
        id: `${id}-line`,
        type: "line",
        source: id,
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": "#5ac8fa",
          "line-width": 3,
          "line-opacity": 0.9,
        },
      },
      {
        id: `${id}-head`,
        type: "fill",
        source: id,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": "#5ac8fa", "fill-opacity": 0.95 },
      },
    ],
    interactive: (id) => [`${id}-line`],
  },

  places: {
    label: "Safe places",
    layers: (id) => [
      {
        id: `${id}-points`,
        type: "circle",
        source: id,
        paint: {
          "circle-radius": ["case", ["==", ["get", "selected"], true], 11, 7],
          "circle-color": [
            "match",
            ["coalesce", ["get", "type"], "hospital"],
            "hospital",
            "#3ddc97",
            "fire_station",
            "#ff6a3d",
            "#5ac8fa",
          ],
          "circle-stroke-width": ["case", ["==", ["get", "selected"], true], 3, 1],
          "circle-stroke-color": "#eaf6ff",
        },
      },
      {
        id: `${id}-labels`,
        type: "symbol",
        source: id,
        layout: {
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-offset": [0, 1.4],
          "text-anchor": "top",
          "text-max-width": 12,
        },
        paint: {
          "text-color": "#eaf6ff",
          "text-halo-color": "rgba(10,14,20,0.9)",
          "text-halo-width": 1.4,
        },
      },
    ],
    interactive: (id) => [`${id}-points`],
  },

  route: {
    label: "Route",
    layers: (id) => [
      {
        id: `${id}-line`,
        type: "line",
        source: id,
        paint: { "line-color": "#ffd166", "line-width": 5, "line-opacity": 0.9 },
      },
    ],
    interactive: (id) => [`${id}-line`],
  },
};

/** Draw order: big areas first, points and labels last. */
export const KIND_ORDER: MapLayerKind[] = [
  "alerts",
  "radius",
  "air",
  "fires",
  "quakes",
  "route",
  "wind",
  "places",
  "home",
];
