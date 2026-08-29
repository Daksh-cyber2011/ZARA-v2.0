/**
 * ZARA V1.0 Phase 2 — Deterministic time-expression parser (Directive §25).
 *
 * Parses English, Hindi and Hinglish time expressions into deterministic
 * structured timestamps BEFORE any reminder is created. Supported families:
 *
 *   - clock times:        "7 baje", "at 7pm", "19:30", "shaam ko 7 baje"
 *   - parts of day:       subah / morning, dopahar / afternoon,
 *                         shaam / evening, raat / raat ko / night
 *   - relative:           "after 20 minutes", "in 2 hours", "20 minute baad",
 *                         "aadha ghanta baad", "1 ghante baad", "kal"
 *   - days:               aaj/today, kal/tomorrow, parso/day after tomorrow,
 *                         day-after, weekday names (EN + HI)
 *   - ISO timestamps      (pass-through)
 *
 * Returns epoch ms or null. NEVER guesses silently: ambiguous hour + part of
 * day resolves by convention documented below; anything unparseable → null.
 */

export interface ParsedTime {
  epochMs: number;
  /** Human-readable resolution trace for diagnostics (no guessing hidden). */
  trace: string;
}

/* ------------------------------ vocab tables ------------------------------- */

const PARTS_OF_DAY: { re: RegExp; from: number; to: number; label: string }[] = [
  { re: /\b(subah|savere|morning)\b/, from: 5, to: 11, label: "morning" },
  { re: /\b(dopahar|dophar|dopeher|afternoon)\b/, from: 12, to: 16, label: "afternoon" },
  { re: /\b(shaam|sham|evening)\b/, from: 17, to: 20, label: "evening" },
  { re: /\b(raat|rat|night)\b/, from: 20, to: 24, label: "night" }
];

const WEEKDAYS_EN = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAYS_HI = ["ravivaar", "somvaar", "mangalvaar", "budhvaar", "guruvaar", "shukravaar", "shanivaar"];
const WEEKDAYS_HI_ALT = ["ravivar", "somvar", "mangalvar", "budhvar", "guruvar", "shukravar", "shanivar"];

const NUM_WORDS: Record<string, number> = {
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhah: 6, che: 6,
  saat: 7, aath: 8, nau: 9, das: 10, gyarah: 11, barah: 12,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12
};

/** Hindi/Hinglish quarter/past notation: "sawa 4" (4:15), "paune 4" (3:45), "dedh" (1:30), "adhai" (2:30). */
function hindiClockSpecial(s: string): { h: number; m: number } | null {
  if (/\bdedh\s*baje\b|\bdedh\b/.test(s)) return { h: 1, m: 30 };
  if (/\badhai\s*baje\b|\badhai\b/.test(s)) return { h: 2, m: 30 };
  const sawa = s.match(/\bsawa\s+(\d{1,2})\b/);
  if (sawa) return { h: parseInt(sawa[1], 10), m: 15 };
  const paune = s.match(/\bpaune\s+(\d{1,2})\b/);
  if (paune) return { h: parseInt(paune[1], 10) - 1, m: 45 };
  const seSawa = s.match(/\b(\d{1,2})\s*sawa\b/);
  if (seSawa) return { h: parseInt(seSawa[1], 10), m: 15 };
  const seAdha = s.match(/\b(\d{1,2})\s*(?:baje\s*)?aadhe?\b/);
  if (seAdha) return { h: parseInt(seAdha[1], 10), m: 30 };
  return null;
}

/* --------------------------------- parser ---------------------------------- */

export function parseTimeExpression(input: string, now: number = Date.now()): ParsedTime | null {
  const s = (input || "").toLowerCase().trim();
  if (!s) return null;

  /* 1. ISO / absolute timestamps */
  if (/^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{10,13}$/.test(s)) {
    const t = /^\d{10,13}$/.test(s) ? parseInt(s, 10) * (s.length === 10 ? 1000 : 1) : Date.parse(s);
    if (!Number.isNaN(t)) return { epochMs: t, trace: "absolute timestamp" };
  }

  const d = new Date(now);
  let trace: string[] = [];

  /* 2. Relative durations: "after 20 minutes", "in 2 hours", "20 minute baad",
   *    "aadha ghanta baad", "1 ghante baad", "10 second baad" */
  const rel = matchRelativeDuration(s);
  if (rel) {
    return { epochMs: now + rel.ms, trace: `relative +${rel.ms}ms (${rel.desc})` };
  }

  /* 3. Day offset: aaj/today(0) · kal/tomorrow(1) · parso/day-after(2) · weekday */
  let dayOffset: number | null = null;
  if (/\b(aaj|today)\b/.test(s)) { dayOffset = 0; trace.push("today"); }
  else if (/\bparso\b|\bday\s*after\s*tomorrow\b/.test(s)) { dayOffset = 2; trace.push("day after tomorrow"); }
  else if (/\b(kal|tomorrow|tmrw)\b/.test(s)) { dayOffset = 1; trace.push("tomorrow"); }
  else {
    const wd = matchWeekday(s, d);
    if (wd !== null) { dayOffset = wd.offset; trace.push(`weekday ${wd.name} (+${wd.offset}d)`); }
  }

  /* 4. Hindi special clock forms (dedh, adhai, sawa, paune, X aadha) */
  const special = hindiClockSpecial(s);

  /* 5. Hour[:minute] [am|pm|baje] */
  let hour: number | null = null;
  let minute = 0;
  let meridiem: "am" | "pm" | null = null;

  if (special) {
    hour = special.h; minute = special.m;
    trace.push(`hindi clock ${hour}:${String(minute).padStart(2, "0")}`);
  } else {
    const m = s.match(/(?:at\s*|@\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje|bje)?\b/);
    if (m) {
      hour = parseInt(m[1], 10);
      minute = m[2] ? parseInt(m[2], 10) : 0;
      if (m[3] === "am") meridiem = "am";
      else if (m[3] === "pm") meridiem = "pm";
      trace.push(`clock ${hour}:${String(minute).padStart(2, "0")}${m[3] ? " " + m[3] : ""}`);
    }
  }

  /* 6. Part-of-day window (subah/dopahar/shaam/raat/morning/afternoon/evening/night) */
  const pod = PARTS_OF_DAY.find(p => p.re.test(s));
  if (pod) trace.push(pod.label);

  /* 7. Resolve */
  if (dayOffset !== null && hour === null && !pod) {
    // A bare day reference without time → that day at 09:00 (documented default).
    d.setDate(d.getDate() + dayOffset);
    d.setHours(9, 0, 0, 0);
    return { epochMs: d.getTime(), trace: [...trace, "default 9:00"].join(" · ") };
  }
  if (dayOffset !== null && hour === null && pod) {
    d.setDate(d.getDate() + dayOffset);
    d.setHours(pod.from, 0, 0, 0);
    return { epochMs: d.getTime(), trace: [...trace, `default ${pod.from}:00`].join(" · ") };
  }
  if (hour === null) return null; // no time information at all

  // Apply meridiem / part-of-day to disambiguate the hour.
  let h = hour;
  if (meridiem === "pm" && h < 12) h += 12;
  else if (meridiem === "am" && h === 12) h = 0;
  else if (!meridiem) {
    if (pod) {
      // "raat ko 9 baje" → 21:00; "shaam 7 baje" → 19:00; "subah 7 baje" → 07:00.
      let hh = h;
      if (pod.from >= 12) {
        while (hh < pod.from) hh += 12; // lift into the afternoon window
        if (hh >= 24) hh -= 12;
      } else if (hh >= 12 && pod.to <= 12) {
        hh -= 12; // morning window, PM-looking hour → AM
      }
      h = hh;
      trace.push(`part-of-day → ${h}:00 window`);
    } else if (dayOffset !== null && h >= 1 && h <= 7) {
      // "kal 7 baje" (no part-of-day) → evening convention (companion default).
      h += 12;
      trace.push("evening convention (bare 1–7 + day offset)");
    } else if (h <= 7) {
      // Bare small hour today: if already past, assume evening of today.
      const probe = new Date(d);
      probe.setHours(h, minute, 0, 0);
      if (probe.getTime() <= now) {
        h += 12;
        trace.push("past small hour → evening today");
      }
    }
  }

  if (dayOffset !== null) d.setDate(d.getDate() + dayOffset);
  d.setHours(h, minute, 0, 0);

  // Bare time already in the past with no day reference → tomorrow (§25 determinism).
  if (dayOffset === null && d.getTime() <= now) {
    d.setDate(d.getDate() + 1);
    trace.push("past → rolled to tomorrow");
  }
  return { epochMs: d.getTime(), trace: trace.join(" · ") || "clock" };
}

/* ------------------------------- sub-matchers -------------------------------- */

function matchRelativeDuration(s: string): { ms: number; desc: string } | null {
  // "after 20 minutes" / "in 20 minutes" / "20 minutes later" / "20 minute baad"
  const min = s.match(/(?:after|in)\s+(\d{1,3})\s*(?:min|mins|minutes?)\b/) ||
              s.match(/(\d{1,3})\s*(?:min|mins|minutes?)\s*(?:baad|later|mei|me)\b/) ||
              s.match(/(\d{1,3})\s*(?:min|mins|minutes?)\s+(?:after|later)\b/);
  if (min) return { ms: parseInt(min[1], 10) * 60000, desc: `${min[1]} minutes` };

  // "aadha ghanta baad" / "half an hour later" / "in half an hour"
  if (/\baadha?\s*ghanta\b/.test(s) || /\bhalf\s+(?:an\s+)?hour\b/.test(s)) {
    return { ms: 1800000, desc: "half hour" };
  }

  // "after 2 hours" / "in 2 hours" / "2 ghante baad"
  const hr = s.match(/(?:after|in)\s+(\d{1,2})\s*(?:hours?|hrs?|h)\b/) ||
             s.match(/(\d{1,2})\s*(?:hours?|hrs?|h)\s*(?:baad|later|mei|me)\b/) ||
             s.match(/(\d{1,2})\s*ghante?\s*(?:baad|later|mei|me)?\b/);
  if (hr) return { ms: parseInt(hr[1], 10) * 3600000, desc: `${hr[1]} hours` };
  const hrWord = s.match(/\b(ek|do|teen)\s*ghante?\s*(?:baad|later|mei|me)?\b/);
  if (hrWord) return { ms: NUM_WORDS[hrWord[1]] * 3600000, desc: `${hrWord[1]} ghante` };

  // "after 30 seconds" / "30 second baad"
  const sec = s.match(/(?:after|in)\s+(\d{1,3})\s*(?:sec|secs|seconds?)\b/) ||
              s.match(/(\d{1,3})\s*(?:sec|secs|seconds?)\s*(?:baad|later)\b/);
  if (sec) return { ms: parseInt(sec[1], 10) * 1000, desc: `${sec[1]} seconds` };

  return null;
}

function matchWeekday(s: string, now: Date): { name: string; offset: number } | null {
  let target: number | null = null;
  let name = "";
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b${WEEKDAYS_EN[i]}\\b`).test(s)) { target = i; name = WEEKDAYS_EN[i]; break; }
    if (new RegExp(`\\b(?:${WEEKDAYS_HI[i]}|${WEEKDAYS_HI_ALT[i]})\\b`).test(s)) { target = i; name = WEEKDAYS_HI[i]; break; }
  }
  if (target === null) return null;
  // "next monday" pushes an extra week when today IS that day.
  const today = now.getDay();
  let offset = (target - today + 7) % 7;
  if (offset === 0) offset = /\bnext\b/.test(s) ? 7 : 1; // "monday" said on monday → next monday
  return { name, offset };
}
