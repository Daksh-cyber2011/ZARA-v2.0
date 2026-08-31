/**
 * ZARA V2.1 — Aspect-aware framing tests.
 *
 * The framing math must guarantee, on ANY aspect ratio (tall phone →
 * ultrawide monitor), that the requested body coverage is fully inside the
 * frame on BOTH axes — never cropped, never absurdly small.
 */
import { describe, it, expect } from "vitest";
import { VIEW_SPECS, fitDistance, baseDistance, viewDistance, defaultViewFor, clampZoom } from "../src/avatar/renderer/framing";

const H = 1.55; // typical VRM model height (m)
const R = 0.28;  // typical half-width incl. arms

function input(aspect: number) {
  return { modelHeight: H, modelRadius: R, fovDeg: 30, aspect };
}

describe("fitDistance — both axes always fit", () => {
  it("fits vertical: square canvas, full body", () => {
    const frame = H * 1.1;
    const d = fitDistance(frame, R * 2, 30, 1);
    const vHalf = (30 * Math.PI) / 180 / 2;
    // vertical visible height at distance d must be >= frame
    expect(2 * d * Math.tan(vHalf)).toBeGreaterThanOrEqual(frame - 1e-9);
  });

  it("fits horizontal on narrow (phone) aspect — the V2.0 bug", () => {
    // Phone portrait: aspect 0.46 (e.g. 390×844). The width fit must win
    // (distance driven by the horizontal FOV) so the body is never cropped.
    const frameW = R * 2 * 1.3;
    const d = fitDistance(H * 0.5, frameW, 30, 0.46);
    const vHalf = (30 * Math.PI) / 180 / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * 0.46);
    expect(2 * d * Math.tan(hHalf)).toBeGreaterThanOrEqual(frameW - 1e-9);
  });

  it("wider screens need LESS distance for the same width (no tiny avatar)", () => {
    const dNarrow = fitDistance(H * 0.6, R * 2 * 1.1, 30, 0.5);
    const dWide = fitDistance(H * 0.6, R * 2 * 1.1, 30, 2.0);
    expect(dWide).toBeLessThan(dNarrow);
  });
});

describe("viewDistance — presets frame their coverage", () => {
  it("every preset frames at least its coverage on every aspect", () => {
    for (const aspect of [0.42, 0.5, 0.75, 1, 1.33, 1.78, 2.4]) {
      for (const [name, spec] of Object.entries(VIEW_SPECS)) {
        const { dist } = viewDistance(input(aspect), spec);
        expect(dist).toBeGreaterThan(0);
        expect(dist).toBeLessThan(8); // sane camera distance for a 1.55m character
        // vertical coverage check
        const vHalf = (30 * Math.PI) / 180 / 2;
        const visibleH = 2 * dist * Math.tan(vHalf);
        expect(visibleH).toBeGreaterThanOrEqual(H * spec.coverage * 0.98);
        // name for failure messages
        expect(name).toBeTruthy();
      }
    }
  });

  it("close-up (portrait) is meaningfully closer than full body", () => {
    const close = viewDistance(input(0.46), VIEW_SPECS.portrait).dist;
    const full = viewDistance(input(0.46), VIEW_SPECS.full).dist;
    expect(close).toBeLessThan(full * 0.55);
  });

  it("focus height is within the body", () => {
    for (const spec of Object.values(VIEW_SPECS)) {
      const { focusY } = viewDistance(input(1), spec);
      expect(focusY).toBeGreaterThan(H * 0.1);
      expect(focusY).toBeLessThanOrEqual(H * 1.05);
    }
  });
});

describe("baseDistance + zoom clamp", () => {
  it("full-body base is finite and sane across aspects", () => {
    for (const aspect of [0.42, 1, 2.4]) {
      const d = baseDistance(input(aspect));
      expect(d).toBeGreaterThan(0.5);
      expect(d).toBeLessThan(5);
    }
  });

  it("zoom clamps around the base", () => {
    const base = baseDistance(input(1));
    expect(clampZoom(base * 10, base)).toBeCloseTo(base * 2.4);
    expect(clampZoom(base * 0.01, base)).toBeCloseTo(base * 0.32);
    expect(clampZoom(base, base)).toBe(base);
  });
});

describe("defaultViewFor", () => {
  it("opens on the companion three-quarter shot everywhere (readable + alive)", () => {
    expect(defaultViewFor(0.42)).toBe("threeQuarter");
    expect(defaultViewFor(1.78)).toBe("threeQuarter");
  });
});
