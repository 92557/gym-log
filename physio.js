// Physio log: turns a note written the way you'd write it in Notes
// ("sat on bus 40 mins hamstring 2.5/10, knees 1.5") into an activity, scores per area and a time.

// Same categories as the Physio Diary's Activity/Context dropdown; `short` is the chip label.
export const ACTIVITIES = [
  { name: 'Waking', short: 'Waking' },
  { name: 'Sitting - transport', short: 'Bus / transport' },
  { name: 'Sitting - other', short: 'Sitting' },
  { name: 'Sitting - hard surface', short: 'Hard seat' },
  { name: 'Driving', short: 'Driving' },
  { name: 'Cycling (own bike)', short: 'Cycling' },
  { name: 'Lime bike', short: 'Lime bike' },
  { name: 'Running / parkrun', short: 'Running' },
  { name: 'Walking / hiking / standing', short: 'Walking / standing' },
  { name: 'Gym / training', short: 'Gym' },
  { name: 'Football', short: 'Football' },
  { name: 'Padel / tennis', short: 'Padel / tennis' },
  { name: 'General / other', short: 'Other' },
];

// First match wins, so the more specific contexts come first.
const ACTIVITY_RULES = [
  ['Sitting - transport', /\b(bus|train|tube|eurostar|plane|flight|taxi|uber|coach)\b/],
  ['Driving', /\b(driv\w*|drove)\b/],
  ['Lime bike', /\blime\b/],
  ['Cycling (own bike)', /\b(cycl\w*|bike|biked|ride|rode|single speed)\b/],
  ['Running / parkrun', /\b(park ?run|run|ran|running|jog\w*)\b/],
  ['Football', /\b(football|5 ?a ?side|five a side)\b/],
  ['Padel / tennis', /\b(padel|paddle|tennis)\b/],
  ['Walking / hiking / standing', /\b(walk\w*|hik\w*|standing|stood|standing desk)\b/],
  ['Waking', /\b(woke|wake|waking)\b/],
  ['Gym / training', /\b(gym|workout|training|lift\w*)\b/],
  ['Sitting - hard surface', /\b(hard (chair|bench|seat|stool|surface)|bench|stool|metal chair|wooden)\b/],
  ['Sitting - other', /\b(sat|sit|sitting|sofa|couch|chair|office|desk|cafe|pub|toilet|restaurant|cinema)\b/],
];

export const AREAS = ['Hamstring', 'Knee/quad', 'Lower back', 'Other'];
const AREA_RULES = [
  ['Hamstring', null, /\b(hamstrings?|hammy|sit[- ]?bones?|under (my )?buttock|leg|legs)\b/],
  ['Knee/quad', null, /\b(knees?|quads?|quadriceps|patella)\b/],
  ['Lower back', null, /\b(lower back|back)\b/],
  ['Other', 'Shin', /\bshins?\b/], ['Other', 'Calf', /\b(calf|calves)\b/], ['Other', 'Glutes', /\bglutes?\b/],
  ['Other', 'Hip', /\bhips?\b/], ['Other', 'Ankle', /\bankles?\b/], ['Other', 'Foot', /\b(foot|feet)\b/],
  ['Other', 'Achilles', /\bachilles\b/], ['Other', 'Groin', /\b(groin|adductors?|balls?)\b/],
  ['Other', 'Shoulder', /\bshoulders?\b/], ['Other', 'Neck', /\bneck\b/],
];
const FINE = /\b(fine|ok|okay|good|no pain|unnoticeable|felt good)\b/;
// A score is "n/10" or "n-m/10"; a bare number only counts if it isn't a duration, distance or weight.
const SCORE = /(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*\/\s*(?:10|20)\b/g;
const BARE = /(?<![\d.:])(\d+(?:\.\d)?)(?![\d.:]|\s*(?:min|mins|minutes|km|k\b|hr|hrs|hour|hours|kg|x|times|m\b|sec|s\b|am|pm|%))/g;

function findScores(clause) {
  const out = [];
  for (const m of clause.matchAll(SCORE)) {
    const a = Number(m[1]), b = m[2] !== undefined ? Number(m[2]) : null;
    out.push({ at: m.index, end: m.index + m[0].length, v: b === null ? a : (a + b) / 2 });
  }
  if (!out.length) for (const m of clause.matchAll(BARE)) {
    const v = Number(m[1]);
    if (v <= 10) out.push({ at: m.index, end: m.index + m[0].length, v, bare: true });
  }
  return out.filter(s => s.v >= 0 && s.v <= 10);
}

const clock = (h, m, ampm) => {
  let hh = +h;
  if (ampm) { if (hh < 1 || hh > 12) return null; hh = (hh % 12) + (ampm === 'pm' ? 12 : 0); }
  return hh < 24 && +m < 60 ? `${String(hh).padStart(2, '0')}:${m}` : null;
};
// Times written anywhere in a note: 18:30, 8.30, 0830, 7pm, 8:30am. Not scores ("2.50/10"),
// distances ("1500m", "30km") or durations ("40 mins").
const TIME_ANYWHERE = [
  /(?<![\d/.:])(\d{1,2})[:.](\d{2})(?!\d|\s*\/)\s*(am|pm)?\b/,
  /(?<![\d/.:])(\d{1,2})\s*(am|pm)\b/,
  /(?<![\d/.:])(\d{4})(?![\d.:]|\s*(?:m\b|km|k\b|kg|metres|meters|mins?|minutes|s\b|\/))/,
];

function parseTime(text) {
  const raw = text.trim(), t = raw.toLowerCase();
  // A time at the start is taken out of the note ("0830 woke up" → note "woke up").
  let m = t.match(/^\[?(\d{1,2})[:.]?(\d{2})\]?\s*(am|pm)?(?=\s|$|[,;\]])/);
  if (m) { const c = clock(m[1], m[2], m[3]); if (c) return { time: c, rest: raw.slice(m[0].length).replace(/^[\s\]]+/, '') }; }
  m = t.match(/^(\d{1,2})\s*(am|pm)\b/);
  if (m) { const c = clock(m[1], '00', m[2]); if (c) return { time: c, rest: raw.slice(m[0].length).trim() }; }
  // Elsewhere in the text it stays in the note ("Woke up 0830 legs ok"); the earliest valid time wins.
  const [hm, hOnly, fourDigits] = TIME_ANYWHERE.map(re => t.match(re));
  const found = [
    hm && { at: hm.index, time: clock(hm[1], hm[2], hm[3]) },
    hOnly && { at: hOnly.index, time: clock(hOnly[1], '00', hOnly[2]) },
    fourDigits && { at: fourDigits.index, time: clock(fourDigits[1].slice(0, 2), fourDigits[1].slice(2)) },
  ].filter(f => f && f.time).sort((a, b) => a.at - b.at);
  if (found.length) return { time: found[0].time, rest: raw };
  return { time: null, rest: raw };
}

/** Best guess at the entry; everything it returns is shown for the user to confirm or change. */
export function parseLog(text) {
  const { time, rest } = parseTime(text || '');
  const lower = rest.toLowerCase();
  // The activity mentioned first wins; plain "sat" is upgraded when a bus or hard seat is also mentioned.
  const hits = ACTIVITY_RULES.map(([name, re]) => ({ name, at: lower.search(re) })).filter(h => h.at >= 0).sort((a, b) => a.at - b.at);
  let activity = hits[0]?.name || 'General / other';
  if (activity === 'Sitting - other') activity = hits.find(h => h.name === 'Sitting - transport' || h.name === 'Sitting - hard surface')?.name || activity;
  const items = [];
  const put = (area, name, v) => {
    const it = items.find(i => i.area === area && (area !== 'Other' || i.name === name));
    if (it) it.score = Math.max(it.score, v); else items.push({ area, name: name || '', score: v });
  };
  // Split into clauses on punctuation and joining words, but never inside a decimal like 2.5.
  let lastArea = null;
  for (const clause of lower.split(/[,;!?\n]+|(?<!\d)\.|\.(?!\d)|\band\b|\bbut\b/)) {
    const scores = findScores(clause);
    const mentions = [];
    for (const [area, name, re] of AREA_RULES) {
      const m = clause.match(re);
      if (m && !mentions.some(x => m.index >= x.at && m.index < x.end)) {
        mentions.push({ area, name, at: m.index, end: m.index + m[0].length, generic: area === 'Hamstring' && /^legs?$/.test(m[0]), scored: false });
      }
    }
    // Each score belongs to the nearest area named before it ("knees 1.5"), else the nearest after it ("2/10 right quad").
    for (const sc of scores) {
      const before = mentions.filter(m => m.end <= sc.at).sort((a, b) => b.end - a.end)[0];
      const after = mentions.filter(m => m.at >= sc.end).sort((a, b) => a.at - b.at)[0];
      const mt = before || after;
      if (mt && !(sc.bare && mt.generic)) { put(mt.area, mt.name, sc.v); mt.scored = true; lastArea = mt; }
      else if (!mt && !sc.bare) {
        // no area in this clause: the last area mentioned, and in this diary the hamstring by default
        const a = lastArea || { area: 'Hamstring', name: '' };
        put(a.area, a.name, sc.v); lastArea = a;
      }
    }
    for (const mt of mentions) {
      if (!mt.scored && FINE.test(clause)) put(mt.area, mt.name, 0);
      if (mt.scored || FINE.test(clause)) lastArea = lastArea || mt;
    }
  }
  return { time, activity, items, note: rest };
}

// ── summary for the physio ──

export const SHORT = { ...Object.fromEntries(ACTIVITIES.map(a => [a.name, a.short])), 'General / other': 'General' };
const MAIN_AREAS = ['Hamstring', 'Knee/quad', 'Lower back'];
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return dayKey(new Date(y, m - 1, d + n)); };
const fmt = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); };
const r1 = v => Math.round(v * 10) / 10;
const avg = vs => vs.reduce((a, b) => a + b, 0) / vs.length;

/** Physio Diary rows from the sheet → entries. Row: [date, activity, hamstring, notes, knee/quad, lower back, other, other area, id] */
export function diaryEntries(rows) {
  return rows.map(r => {
    const m = /^\[(\d{2}:\d{2})\]/.exec(r[3] || '');
    return { date: r[0], time: m ? m[1] : '', activity: r[1] || 'General / other', note: (r[3] || '').replace(/^\[\d{2}:\d{2}\]\s*/, ''),
      scores: { 'Hamstring': r[2], 'Knee/quad': r[4], 'Lower back': r[5], 'Other': r[6] }, otherArea: r[7] || '', id: r[8] || '' };
  });
}

/** A phone entry (queued or test) in the same shape. */
export function appEntry(e) {
  const scores = { 'Hamstring': null, 'Knee/quad': null, 'Lower back': null, 'Other': null };
  const others = [];
  for (const i of e.items) {
    const k = MAIN_AREAS.includes(i.area) ? i.area : 'Other';
    scores[k] = scores[k] === null ? i.score : Math.max(scores[k], i.score);
    if (k === 'Other') others.push(i.name || 'Other');
  }
  return { date: e.date, time: e.time || '', activity: e.activity, note: e.note || '', scores, otherArea: others.join(', '), id: e.id };
}

/**
 * Summary of the last `days` days up to `today` (yyyy-mm-dd), compared with the `days` before.
 * `workouts`: [{ date, session }] from the Workout Log, used to list training in the period.
 */
export function summarise(entries, { days, today, workouts = [] }) {
  const from = addDays(today, -(days - 1)), prevFrom = addDays(from, -days);
  const inRange = (e, a, b) => e.date >= a && e.date <= b;
  const cur = entries.filter(e => inRange(e, from, today)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const prev = entries.filter(e => inRange(e, prevFrom, addDays(from, -1)));

  const areaNames = [...MAIN_AREAS];
  for (const e of cur) if (e.scores.Other !== null && e.otherArea) for (const n of e.otherArea.split(', ')) if (!areaNames.includes(n)) areaNames.push(n);
  const scoreOf = (e, area) => (MAIN_AREAS.includes(area) ? e.scores[area] : e.otherArea.split(', ').includes(area) ? e.scores.Other : null);

  const areas = areaNames.map(area => {
    const scored = cur.filter(e => typeof scoreOf(e, area) === 'number');
    const prevScored = prev.filter(e => typeof scoreOf(e, area) === 'number');
    if (!scored.length) return { area, n: 0 };
    const worst = scored.reduce((w, e) => (scoreOf(e, area) >= scoreOf(w, area) ? e : w));   // ties: the most recent
    const byAct = {};
    for (const e of scored) (byAct[e.activity] ||= []).push(scoreOf(e, area));
    const acts = Object.entries(byAct).map(([a, vs]) => ({ activity: SHORT[a] || a, n: vs.length, avg: r1(avg(vs)), max: Math.max(...vs) }));
    return {
      area, n: scored.length, avg: r1(avg(scored.map(e => scoreOf(e, area)))),
      prevAvg: prevScored.length ? r1(avg(prevScored.map(e => scoreOf(e, area)))) : null, prevN: prevScored.length,
      worst: { score: scoreOf(worst, area), date: worst.date, time: worst.time, note: worst.note },
      worstWhen: acts.filter(a => a.avg > 0).sort((a, b) => b.avg - a.avg || b.n - a.n).slice(0, 3),
      fineWhen: acts.filter(a => a.max === 0).sort((a, b) => b.n - a.n).map(a => a.activity),
    };
  });

  const flareUps = cur.flatMap(e => areaNames.map(area => ({ e, area, v: scoreOf(e, area) })))
    .filter(x => typeof x.v === 'number' && x.v >= 3)
    .sort((a, b) => b.v - a.v || b.e.date.localeCompare(a.e.date)).slice(0, 6);

  const gym = [...new Map(workouts.filter(w => w.date >= from && w.date <= today).map(w => [`${w.date}|${w.session}`, w])).values()]
    .sort((a, b) => a.date.localeCompare(b.date));
  const activityDays = {};
  for (const e of cur) if (['Football', 'Running / parkrun', 'Cycling (own bike)', 'Padel / tennis'].includes(e.activity)) (activityDays[SHORT[e.activity]] ||= new Set()).add(e.date);

  return { from, to: today, days, entries: cur.length, list: cur, areas, flareUps, gym, activityDays: Object.fromEntries(Object.entries(activityDays).map(([k, v]) => [k, v.size])) };
}

/** Plain text to paste into Messages or email. */
export function summaryText(s) {
  const weeks = s.days % 7 === 0 ? `${s.days / 7} week${s.days > 7 ? 's' : ''}` : `${s.days} days`;
  const L = [`Physio summary: ${fmt(s.from)} – ${fmt(s.to)} (${weeks}), ${s.entries} diary entries`, ''];
  const before = s.days === 7 ? 'week' : weeks;
  for (const a of s.areas) {
    if (!a.n) { if (MAIN_AREAS.includes(a.area)) L.push(`${a.area}: no scores logged`); continue; }
    // a trend needs a few earlier scores to mean anything
    const trend = a.prevAvg === null ? ''
      : a.prevN < 3 ? ` (only ${a.prevN} score${a.prevN > 1 ? 's' : ''} in the ${before} before)`
      : a.avg < a.prevAvg ? ` (down from ${a.prevAvg} the ${before} before)` : a.avg > a.prevAvg ? ` (up from ${a.prevAvg} the ${before} before)` : ' (same as the period before)';
    L.push(`${a.area}: average ${a.avg}/10${trend}, worst ${a.worst.score}/10 on ${fmt(a.worst.date)}${a.worst.time ? ' ' + a.worst.time : ''}. Scored ${a.n} time${a.n > 1 ? 's' : ''}.`);
    if (a.worstWhen.length) L.push(`  Worst when: ${a.worstWhen.map(w => `${w.activity} ${w.avg}${w.n > 1 ? ` (avg of ${w.n})` : ' (once)'}`).join(', ')}`);
    if (a.fineWhen.length) L.push(`  Fine (0) when: ${a.fineWhen.join(', ')}`);
  }
  if (s.flareUps.length) {
    L.push('', 'Highest scores (3/10 or more):');
    for (const f of s.flareUps) L.push(`- ${fmt(f.e.date)}${f.e.time ? ' ' + f.e.time : ''}, ${f.area} ${f.v}/10: ${f.e.note}`);
  }
  const training = [];
  if (s.gym.length) training.push(`gym ${s.gym.length}× (${s.gym.map(g => `${g.session} ${fmt(g.date).replace(/^\w+ /, '')}`).join(', ')})`);
  for (const [k, n] of Object.entries(s.activityDays)) training.push(`${k.toLowerCase()} ${n} day${n > 1 ? 's' : ''}`);
  if (training.length) L.push('', `Training in this period: ${training.join('; ')}.`);
  return L.join('\n');
}
