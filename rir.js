// RIR-based load engine.
// Estimated 1RM uses Epley on "effective reps" (reps done + reps left in reserve):
//   e1RM = weight × (1 + (reps + RIR) / 30)
// and inverts it to find the weight that should give the target reps at the target RIR.

export const DEFAULT_RIR = 2;          // assumed for old log rows with no RIR recorded
export const MAX_UP = 0.05;            // in-session: never add more than 5 % to the next set
export const MAX_DOWN = 0.10;          // …or drop more than 10 %
export const HISTORY_BAND = 0.10;      // history suggestion stays within ±10 % of the plan

/** Turns whatever is in the RIR/RPE column ("3", "1-2", "RPE 8", "RPE 7/8/8", "2+ on 20kg") into RIR. */
export function parseRir(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).trim();
  if (/rpe/i.test(s)) {
    const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter(n => n <= 10);
    return nums.length ? Math.max(0, 10 - nums[nums.length - 1]) : null;
  }
  let m = s.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  if (m) return (Number(m[1]) + Number(m[2])) / 2;
  m = s.match(/^(\d+(?:\.\d+)?)/);
  if (m && Number(m[1]) <= 6) return Number(m[1]);
  return null;
}

export function e1rm(w, r, rir) {
  if (!(w > 0) || !(r > 0)) return null;
  const eff = r + (rir ?? DEFAULT_RIR);
  if (eff > 20) return null;                     // too many reps for a meaningful estimate
  return eff <= 1 ? w : w * (1 + eff / 30);
}

export function weightFor(e, reps, rir) {
  const eff = reps + (rir ?? DEFAULT_RIR);
  return eff <= 1 ? e : e / (1 + eff / 30);
}

export function roundTo(w, step) {
  return Math.round(Math.round(w / step) * step * 100) / 100;
}

export function stepFor(name, settings) {
  if (/\b(db|dumbbells?|kettlebells?|kb)\b/i.test(name)) return settings.stepDumbbell;
  if (/machine|cable|pulldown|curl|leg press|pec deck|face pull/i.test(name)) return settings.stepOther;
  return settings.stepBarbell;
}

/** Heavy barbell-style lifts that deserve an automatic warm-up ramp. */
export function isBarbell(name) {
  if (/\b(db|dumbbell|kettlebell|cable|machine|pulldown|pull-?up|chin|dip|push-?up|row|curl|lunge|step-?up|calf|side bend|split squat|goblet|single-|nordic|band|muscle-?up|face pull|staggered|kickstand)/i.test(name)) return false;
  return /squat|deadlift|press|bench|thrust|bridge|rdl|clean|jerk/i.test(name);
}

/**
 * After a working set: what should the next set weigh so it lands on its target reps @ RIR?
 * Returns null when there is not enough information (no weight or no RIR entered).
 */
export function nextSetWeight(done, target, step) {
  if (!(done.w > 0) || !(done.r > 0) || done.rir === null || done.rir === undefined) return null;
  const e = e1rm(done.w, done.r, done.rir);
  if (!e) return null;
  const hi = done.w * (1 + MAX_UP), lo = done.w * (1 - MAX_DOWN);
  let r = roundTo(Math.min(Math.max(weightFor(e, target.reps, target.rir), lo), hi), step);
  if (r > hi + 1e-9) r = roundTo(r - step, step);   // rounding must not break the caps
  if (r < lo - 1e-9) r = roundTo(r + step, step);
  return r;
}

/** Best estimated 1RM from the most recent session that had weighted sets. */
export function lastSessionE1rm(sessions) {
  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i];
    const best = Math.max(0, ...s.sets.map(x => e1rm(x.w, x.r, x.rir) || 0));
    if (best > 0) return { e: best, date: s.date };
  }
  return null;
}

/** Suggest a starting weight from history for a target, kept within ±10 % of the planned weight. */
export function historySuggestion(sessions, target, planned, step, maxAgeDays = 42) {
  const last = lastSessionE1rm(sessions);
  if (!last) return null;
  if ((Date.now() - new Date(last.date).getTime()) / 86400000 > maxAgeDays) return null;
  let w = weightFor(last.e, target.reps, target.rir);
  if (planned > 0) w = Math.min(Math.max(w, planned * (1 - HISTORY_BAND)), planned * (1 + HISTORY_BAND));
  w = roundTo(w, step);
  if (planned > 0 && Math.abs(w - planned) < step) return null;
  return { w, e: last.e, date: last.date };
}
