/**
 * The two animations the spec asks for (SPEC 8.3): a pulsing marker for the
 * user's location and a wind arrow that visibly moves.
 *
 * Both drive MapLibre paint properties from one requestAnimationFrame loop
 * rather than one loop each, and both stop themselves when the viewer has asked
 * for reduced motion.
 */
import type { Map as MapLibreMap } from "maplibre-gl";

const PULSE_PERIOD_MS = 2200;
const DASH_PERIOD_MS = 1400;

/** Dash patterns cycled to make the wind line look like it is flowing. */
const DASH_FRAMES: [number, number][] = [
  [0, 4],
  [1, 3],
  [2, 2],
  [3, 1],
  [4, 0],
];

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Starts the loop and returns a stop function. Layers that are not on the map
 * yet are simply skipped each frame, so this can start before the first answer.
 */
export function startAnimations(map: MapLibreMap): () => void {
  if (prefersReducedMotion()) return () => {};

  let frame = 0;
  let stopped = false;

  const tick = (time: number): void => {
    if (stopped) return;

    // Home marker: a ring that swells and fades, like a device listening.
    if (map.getLayer("home-pulse")) {
      const phase = (time % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
      map.setPaintProperty("home-pulse", "circle-radius", 8 + phase * 26);
      map.setPaintProperty("home-pulse", "circle-opacity", 0.35 * (1 - phase));
    }

    // Wind: a dash pattern marching along the line, in the direction of travel.
    if (map.getLayer("wind-line")) {
      const step = Math.floor(time / (DASH_PERIOD_MS / DASH_FRAMES.length)) % DASH_FRAMES.length;
      map.setPaintProperty("wind-line", "line-dasharray", DASH_FRAMES[step] as [number, number]);
    }

    frame = requestAnimationFrame(tick);
  };

  frame = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
  };
}
