/**
 * ZARA V1.0 Phase 2 — Time expression parser tests (Directive §25).
 *
 * All parsing resolves into deterministic structured timestamps BEFORE any
 * reminder is created. English + Hindi + Hinglish + mixed.
 */
import { describe, it, expect } from "vitest";
import { parseTimeExpression } from "../src/core/time/TimeParser";

/** Fixed "now": 2026-03-10 (Tuesday) 14:00 local. */
const NOW = new Date(2026, 2, 10, 14, 0, 0, 0).getTime();

function at(epochMs: number): { d: number; h: number; m: number } {
  const d = new Date(epochMs);
  return { d: d.getDate(), h: d.getHours(), m: d.getMinutes() };
}

describe("TimeParser (§25 — EN/HI/Hinglish determinism)", () => {
  /* -- directive examples, verbatim -- */
  it("'kal 7 baje' → tomorrow 19:00 (Hinglish evening convention)", () => {
    const r = parseTimeExpression("kal 7 baje", NOW);
    expect(r).not.toBeNull();
    const t = at(r!.epochMs);
    expect(t.d).toBe(11);
    expect(t.h).toBe(19);
  });

  it("'tomorrow at 7' → tomorrow 19:00 (same convention in EN)", () => {
    const r = parseTimeExpression("tomorrow at 7", NOW);
    const t = at(r!.epochMs);
    expect(t.d).toBe(11);
    expect(t.h).toBe(19);
  });

  it("'raat ko 9 baje' → today 21:00 (part-of-day disambiguation)", () => {
    const r = parseTimeExpression("raat ko 9 baje", NOW);
    const t = at(r!.epochMs);
    expect(t.d).toBe(10);
    expect(t.h).toBe(21);
  });

  it("'after 20 minutes' → now + 20 min", () => {
    const r = parseTimeExpression("after 20 minutes", NOW);
    expect(r!.epochMs).toBe(NOW + 20 * 60000);
  });

  /* -- relative durations, Hinglish -- */
  it("'20 minute baad' → now + 20 min", () => {
    expect(parseTimeExpression("20 minute baad", NOW)!.epochMs).toBe(NOW + 20 * 60000);
  });
  it("'in 2 hours' → now + 2 h", () => {
    expect(parseTimeExpression("in 2 hours", NOW)!.epochMs).toBe(NOW + 2 * 3600000);
  });
  it("'aadha ghanta baad' → now + 30 min", () => {
    expect(parseTimeExpression("aadha ghanta baad", NOW)!.epochMs).toBe(NOW + 1800000);
  });
  it("'half an hour later' → now + 30 min", () => {
    expect(parseTimeExpression("half an hour later", NOW)!.epochMs).toBe(NOW + 1800000);
  });
  it("'1 ghante baad' → now + 1 h", () => {
    expect(parseTimeExpression("1 ghante baad", NOW)!.epochMs).toBe(NOW + 3600000);
  });
  it("'after 30 seconds' → now + 30 s", () => {
    expect(parseTimeExpression("after 30 seconds", NOW)!.epochMs).toBe(NOW + 30000);
  });

  /* -- parts of day -- */
  it("'subah 8 baje' → tomorrow 08:00 (morning already passed today)", () => {
    const r = parseTimeExpression("subah 8 baje", NOW);
    const t = at(r!.epochMs);
    expect(t.h).toBe(8);
    expect(t.d).toBe(11); // 8:00 today is past 14:00 → rolled to tomorrow
  });
  it("'shaam ko 7 baje' → today 19:00 (evening)", () => {
    const r = parseTimeExpression("shaam ko 7 baje", NOW);
    const t = at(r!.epochMs);
    expect(t.d).toBe(10);
    expect(t.h).toBe(19);
  });
  it("'dopahar 2 baje' → 14:00 (afternoon window)", () => {
    const r = parseTimeExpression("dopahar 2 baje", NOW);
    const t = at(r!.epochMs);
    expect(t.h).toBe(14);
  });
  it("'morning at 9' → 09:00", () => {
    const r = parseTimeExpression("morning at 9", NOW);
    expect(at(r!.epochMs).h).toBe(9);
  });
  it("'tomorrow morning 6' → tomorrow 06:00", () => {
    const r = parseTimeExpression("tomorrow morning 6", NOW);
    const t = at(r!.epochMs);
    expect(t.d).toBe(11);
    expect(t.h).toBe(6);
  });

  /* -- day references -- */
  it("'kal' alone → tomorrow 09:00 default", () => {
    const r = parseTimeExpression("kal", NOW);
    const t = at(r!.epochMs);
    expect(t.d).toBe(11);
    expect(t.h).toBe(9);
  });
  it("'parso' → +2 days", () => {
    const r = parseTimeExpression("parso", NOW);
    expect(at(r!.epochMs).d).toBe(12);
  });
  it("'day after tomorrow at 6pm' → +2 days 18:00", () => {
    const r = parseTimeExpression("day after tomorrow at 6pm", NOW);
    const t = at(r!.epochMs);
    expect(t.d).toBe(12);
    expect(t.h).toBe(18);
  });
  it("'monday 9am' → next Monday 09:00 (today is Tuesday)", () => {
    const r = parseTimeExpression("monday 9am", NOW);
    const t = new Date(r!.epochMs);
    expect(t.getDay()).toBe(1);
    expect(t.getHours()).toBe(9);
    expect(r!.epochMs).toBeGreaterThan(NOW);
  });
  it("'somvaar ko 8 baje' → next Monday (Hindi weekday)", () => {
    const r = parseTimeExpression("somvaar ko 8 baje", NOW);
    const t = new Date(r!.epochMs);
    expect(t.getDay()).toBe(1);
    expect(t.getHours()).toBeGreaterThanOrEqual(8);
  });

  /* -- clock forms -- */
  it("'at 19:30' → 19:30", () => {
    const r = parseTimeExpression("at 19:30", NOW);
    const t = at(r!.epochMs);
    expect(t.h).toBe(19);
    expect(t.m).toBe(30);
  });
  it("'7:30pm' → 19:30", () => {
    const r = parseTimeExpression("7:30pm", NOW);
    const t = at(r!.epochMs);
    expect(t.h).toBe(19);
    expect(t.m).toBe(30);
  });
  it("'sawa 4 baje' → 16:15 (Hindi quarter-past)", () => {
    const r = parseTimeExpression("sawa 4 baje", NOW);
    const t = at(r!.epochMs);
    expect(t.h).toBe(16);
    expect(t.m).toBe(15);
  });
  it("'paune 4 baje' → 15:45 (Hindi quarter-to)", () => {
    const r = parseTimeExpression("paune 4 baje", NOW);
    const t = at(r!.epochMs);
    expect(t.h).toBe(15);
    expect(t.m).toBe(45);
  });
  it("'dedh baje' → 13:30 (one-thirty)", () => {
    const r = parseTimeExpression("dedh baje", NOW);
    const t = at(r!.epochMs);
    expect(t.h).toBe(13);
    expect(t.m).toBe(30);
  });

  /* -- absolute forms -- */
  it("ISO timestamps pass through", () => {
    const r = parseTimeExpression("2026-03-15T09:00:00", NOW);
    expect(r).not.toBeNull();
    expect(new Date(r!.epochMs).getDate()).toBe(15);
  });

  /* -- honesty: null for garbage (§25 determinism, no guessing) -- */
  it("returns null for unparseable input", () => {
    expect(parseTimeExpression("banana submarine", NOW)).toBeNull();
    expect(parseTimeExpression("", NOW)).toBeNull();
  });

  it("every successful parse carries a diagnostic trace", () => {
    const r = parseTimeExpression("kal raat 9 baje", NOW);
    expect(r!.trace.length).toBeGreaterThan(0);
    expect(r!.trace).toContain("tomorrow");
    const t = at(r!.epochMs);
    expect(t.d).toBe(11);
    expect(t.h).toBe(21);
  });
});
