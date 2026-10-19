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
const BARE = /(?<![\d.:])(\d+(?:\.\d+)?)(?![\d.:]|\s*(?:min|mins|minutes|km|k\b|hr|hrs|hour|hours|kg|x|times|m\b|sec|s\b|am|pm|%))/g;

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

function parseTime(text) {
  const t = text.trim().toLowerCase();
  let m = t.match(/^\[?(\d{1,2})[:.]?(\d{2})\]?\b/);
  if (m && +m[1] < 24 && +m[2] < 60) return { time: `${m[1].padStart(2, '0')}:${m[2]}`, rest: text.trim().slice(m[0].length).trim() };
  m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (m && +m[1] <= 12) {
    const h = (+m[1] % 12) + (m[3] === 'pm' ? 12 : 0);
    return { time: `${String(h).padStart(2, '0')}:${m[2] || '00'}`, rest: text.trim().slice(m[0].length).trim() };
  }
  return { time: null, rest: text.trim() };
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
