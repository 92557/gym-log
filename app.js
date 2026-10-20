import { kvGet, kvSet, kvDel, outboxAll, outboxPut, outboxDelete } from './db.js';
import * as R from './rir.js';
import { lineChart } from './charts.js';
import { muscleInfo, bodyMap, muscleList } from './muscles.js';
import { ACTIVITIES, AREAS, parseLog, diaryEntries, appEntry, summarise, summaryText } from './physio.js';

const VERSION = '12';   // keep in step with the cache name in sw.js
const DEFAULT_SETTINGS = {
  url: '', token: '',
  hamstring: true,          // before/after body check-in → Physio Diary (setting name kept from v1)
  autoWarmups: true,        // add a ramp to heavy barbell lifts that have none planned
  autoAdjust: true,         // RIR engine changes the next sets' weight mid-session
  keepAwake: true,          // screen stays on during a workout
  defaultRest: 90,
  stepBarbell: 2.5, stepDumbbell: 2, stepOther: 2.5,
  testMode: false,          // practise without anything reaching the sheet
};

const S = {
  settings: { ...DEFAULT_SETTINGS },
  data: null,               // last bootstrap from the sheet
  current: null,            // in-progress workout
  local: [],                // sessions saved on the phone but not yet visible in `data`
  done: {},                 // planned-session keys finished/skipped locally
  testLocal: [],            // test-mode sessions: phone only, never queued for the sheet
  testDone: {},             // test-mode "done" marks, kept apart from the real ones
  testPhysio: [],           // test-mode physio log entries (phone only)
  plog: null,               // physio log entry being written
  psum: { days: 14, queued: [] },   // physio summary period and entries still waiting to sync
  pending: 0,
  syncing: false, lastSync: null, lastError: null,
  view: 'today',
  progress: { ex: null, range: 365 },
  rest: { end: 0, total: 0, fired: false },
  index: new Map(),
  lastSummary: null,
};

// ───────────────────────────── utils ─────────────────────────────

const $ = sel => document.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const key = name => String(name || '').trim().toLowerCase();
const dayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDay = s => parseDay(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtShort = s => parseDay(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const hhmm = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const mmss = sec => `${Math.floor(sec / 60)}:${pad(Math.max(0, sec) % 60)}`;
const num = v => { if (v === '' || v === null || v === undefined) return null; const n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : null; };
const kg = w => (w > 0 ? `${+w.toFixed(2)}` : 'BW');
// A blank weight on a normally weighted lift means "not recorded", not bodyweight.
const isWeighted = name => (S.index.get(key(name))?.bestW || 0) > 0;
const kgFor = (w, name) => (w > 0 ? kg(w) : isWeighted(name) ? '?' : 'BW');
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
// Test mode has its own in-progress workout, saved sessions and done marks, and never writes to the outbox.
const testing = () => !!S.settings.testMode;
const currentKey = () => (testing() ? 'test:current' : 'current');
const doneMarks = () => (testing() ? S.testDone : S.done);
const relDays = s => { const d = Math.round((parseDay(s) - parseDay(dayStr())) / 86400000); return d === 0 ? 'today' : d === 1 ? 'tomorrow' : d === -1 ? 'yesterday' : d < 0 ? `${-d} days ago` : `in ${d} days`; };

let toastTimer;
function toast(msg, ms = 3500) {
  const el = $('#toast');
  el.innerHTML = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

let saveTimer;
function saveCurrent(now = false) {
  clearTimeout(saveTimer);
  const k = currentKey();
  const go = () => (S.current ? kvSet(k, S.current) : kvDel(k));
  if (now) return go();
  saveTimer = setTimeout(go, 300);
}

// ───────────────────────────── history index ─────────────────────────────

/** Groups every logged set (sheet + not-yet-synced phone sessions) by exercise → sessions. */
function buildIndex() {
  const idx = new Map();
  const push = (date, session, name, w, r, rirRaw, setNo) => {
    const k = key(name);
    if (!idx.has(k)) idx.set(k, { name, sessions: [] });
    const e = idx.get(k);
    let s = e.sessions[e.sessions.length - 1];
    if (!s || s.date !== date || s.session !== session) {
      s = e.sessions.find(x => x.date === date && x.session === session);
      if (!s) { s = { date, session, sets: [] }; e.sessions.push(s); }
    }
    s.sets.push({ w: w || 0, r: r || 0, rir: R.parseRir(rirRaw), rirRaw, set: setNo });
  };
  for (const h of S.data?.history || []) push(h[0], h[1], h[2], h[4], h[5], h[6], h[3]);
  for (const l of S.local) for (const s of l.sets) push(l.date, l.session, s.exercise, s.weight, s.reps, s.rir, s.set);
  if (testing()) for (const l of S.testLocal) for (const s of l.sets) push(l.date, `${l.session} (test)`, s.exercise, s.weight, s.reps, s.rir, s.set);
  for (const e of idx.values()) {
    e.sessions.sort((a, b) => a.date.localeCompare(b.date));
    e.bestW = 0; e.bestE = 0; e.bestReps = 0; e.bestWDate = null;
    for (const s of e.sessions) for (const x of s.sets) {
      if (x.w > e.bestW && x.r > 0) { e.bestW = x.w; e.bestWDate = s.date; }
      const est = R.e1rm(x.w, x.r, x.rir);
      if (est > e.bestE) e.bestE = est;
      if (!(x.w > 0) && x.r > e.bestReps) e.bestReps = x.r;
    }
    e.last = e.sessions[e.sessions.length - 1]?.date || '';
  }
  // canonical spelling from the tracker's exercise list wins
  for (const n of S.data?.exercises || []) if (idx.has(key(n))) idx.get(key(n)).name = n;
  S.index = idx;
}

function canonName(name) {
  const k = key(name);
  return (S.data?.exercises || []).find(n => key(n) === k) || S.index.get(k)?.name || String(name).trim();
}

// ───────────────────────────── planned sessions ─────────────────────────────

function plannedGroups() {
  const groups = new Map();
  for (const r of S.data?.planned || []) {
    const k = `${r.date}|${r.session}`;
    if (!groups.has(k)) groups.set(k, { key: k, date: r.date, session: r.session, rows: [] });
    groups.get(k).rows.push(r);
  }
  const list = [...groups.values()].filter(g => !doneMarks()[g.key]).sort((a, b) => a.date.localeCompare(b.date));
  return testing() ? [practiceGroup(), ...list] : list;
}

/** Built-in session for test mode, so the whole flow can be tried even when nothing is planned. */
function practiceGroup() {
  const date = dayStr(), session = 'Practice session';
  const row = (order, exercise, set, type, weight = null, reps = null, rir = null, rest = null, cue = '') =>
    ({ date, session, order, exercise, set, type, weight, reps, rir, rest, cue });
  const tip1 = 'Try it: put RIR 4 on set 1 (easier than the target 2) and watch set 2 get heavier';
  const tip2 = 'Ticking a set starts the rest timer (30 s in practice)';
  return { key: `${date}|${session}`, date, session, rows: [
    row(0, 'Easy row or bike 3 min', null, 'warmup'),
    row(0, 'Band pull-aparts 2x15', null, 'warmup'),
    row(1, 'Trap-Bar Deadlift', 1, 'ramp', 60, 5, null, 30),
    row(1, 'Trap-Bar Deadlift', 2, 'ramp', 80, 3, null, 30),
    row(1, 'Trap-Bar Deadlift', 1, 'working', 100, 5, '2', 30, tip1),
    row(1, 'Trap-Bar Deadlift', 2, 'working', 100, 5, '2', 30, tip1),
    row(2, 'DB Bench Press', 1, 'working', 32, 8, '2', 30, tip2),
    row(2, 'DB Bench Press', 2, 'working', 32, 8, '2', 30, tip2),
    row(3, 'Nordic Hamstring Curl', 1, 'working', null, 4, null, 30),
    row(3, 'Nordic Hamstring Curl', 2, 'working', null, 4, null, 30),
  ] };
}

function mkSet(type, tw, tr, trir, rest) {
  return { id: uid(), type, tw: tw ?? null, tr: tr ?? null, trir: trir ?? null, rest: rest ?? null,
    w: tw ?? null, r: tr ?? null, rir: null, done: false, pr: null, adj: null, touched: false, auto: false };
}

function newWorkout(session, plannedKey = null) {
  return { id: uid(), session, plannedKey, date: dayStr(), startedAt: new Date().toISOString(),
    checks: { before: null, after: null }, warmups: [], exercises: [] };
}

function workoutFromPlan(g) {
  const w = newWorkout(g.session, g.key);
  const byOrder = new Map();
  for (const r of g.rows) {
    if (r.type === 'warmup') { w.warmups.push({ text: r.exercise, done: false }); continue; }
    const k = r.order ?? r.exercise;
    if (!byOrder.has(k)) byOrder.set(k, { id: uid(), name: canonName(r.exercise), cue: '', note: '', sets: [] });
    const ex = byOrder.get(k);
    if (r.cue && !ex.cue) ex.cue = r.cue;
    ex.sets.push(mkSet(r.type === 'ramp' ? 'ramp' : 'working', r.weight, r.reps, R.parseRir(r.rir), r.rest));
  }
  w.exercises = [...byOrder.entries()].sort((a, b) => (Number(a[0]) || 0) - (Number(b[0]) || 0)).map(([, ex]) => {
    ex.sets = [...ex.sets.filter(s => s.type === 'ramp'), ...ex.sets.filter(s => s.type === 'working')];
    if (S.settings.autoWarmups) addRamps(ex, true);
    ex.hint = historyHint(ex);
    return ex;
  });
  return w;
}

/** Warm-up ramp for heavy barbell lifts: (bar) → 50 % → 70 % → 85 % of the first working weight. */
function addRamps(ex, onlyIfBarbell) {
  if (ex.sets.some(s => s.type === 'ramp')) return false;
  const first = ex.sets.find(s => s.type === 'working');
  const t = first?.w || first?.tw;
  if (!(t >= 30) || (onlyIfBarbell && !(R.isBarbell(ex.name) && t >= 40))) return false;
  const step = R.stepFor(ex.name, S.settings);
  const bar = R.isBarbell(ex.name) && !/trap/i.test(ex.name);
  const ramps = [];
  if (bar && t >= 60) ramps.push([20, 8]);
  for (const [p, reps] of [[0.5, 5], [0.7, 3], [0.85, 1]]) {
    const w = R.roundTo(t * p, step);
    if (w < t && w >= (bar ? 20 : step) && !ramps.some(r => r[0] === w)) ramps.push([w, reps]);
  }
  ex.sets.unshift(...ramps.map(([w, reps]) => ({ ...mkSet('ramp', w, reps, null, 60), auto: true })));
  return ramps.length > 0;
}

function historyHint(ex) {
  const s = ex.sets.find(x => x.type === 'working' && !x.done);
  if (!s || !(s.tw > 0) || !s.tr) return null;
  const h = S.index.get(key(ex.name));
  if (!h) return null;
  return R.historySuggestion(h.sessions, { reps: s.tr, rir: s.trir }, s.tw, R.stepFor(ex.name, S.settings));
}

function lastTime(name) {
  const h = S.index.get(key(name));
  const s = h?.sessions[h.sessions.length - 1];
  if (!s) return null;
  return { date: s.date, text: s.sets.map(x => `${kgFor(x.w, name)}×${x.r || '?'}${x.rir !== null ? ` @${x.rir}` : ''}`).join(' · ') };
}

function exerciseFromHistory(name) {
  const ex = { id: uid(), name: canonName(name), cue: '', note: '', sets: [], hint: null };
  const h = S.index.get(key(ex.name));
  const last = h?.sessions[h.sessions.length - 1];
  const tmpl = last?.sets.length ? last.sets : [{ w: null, r: null }, { w: null, r: null }, { w: null, r: null }];
  for (const x of tmpl.slice(0, 5)) ex.sets.push(mkSet('working', x.w || null, x.r || null, R.DEFAULT_RIR, null));
  ex.hint = historyHint(ex);   // nudge from the RIR engine if last time had effort data
  return ex;
}

// ───────────────────────────── workout actions ─────────────────────────────

function tickSet(ei, si) {
  const ex = S.current.exercises[ei], s = ex.sets[si];
  unlockAudio();
  if (s.done) { s.done = false; s.pr = null; render(); saveCurrent(); return; }
  s.done = true; s.doneAt = Date.now();
  let msg = '';
  if (s.type === 'working') {
    s.pr = prFor(ex, s);
    if (s.pr) msg = `🏆 ${s.pr}! ${kg(s.w)} kg × ${s.r}`;
    const adj = S.settings.autoAdjust ? adjustNext(ex, si) : null;
    if (adj) msg += `${msg ? '<br>' : ''}${adj}`;
  }
  const rest = s.rest ?? (s.type === 'ramp' ? 0 : S.settings.defaultRest);
  const anyLeft = S.current.exercises.some(e => e.sets.some(x => !x.done));
  if (rest > 0 && anyLeft) startRest(rest);
  if (msg) toast(msg, 5000);
  render(); saveCurrent();
}

/** Uses the RIR just logged to re-target the remaining working sets of this exercise. */
function adjustNext(ex, si) {
  const s = ex.sets[si];
  if (s.rir === null || !(s.w > 0) || !(s.r > 0)) return null;
  const step = R.stepFor(ex.name, S.settings);
  let changed = null;
  for (const n of ex.sets.slice(si + 1)) {
    if (n.type !== 'working' || n.done || n.touched) continue;
    const target = { reps: n.tr ?? n.r ?? s.r, rir: n.trir ?? s.trir ?? R.DEFAULT_RIR };
    const w = R.nextSetWeight({ w: s.w, r: s.r, rir: s.rir }, target, step);
    if (w === null || Math.abs(w - (n.w || 0)) < step / 2) continue;
    n.adj = { from: n.w }; n.w = w; changed = { w, target };
  }
  if (!changed) return null;
  const dir = changed.w > s.w ? '↑' : changed.w < s.w ? '↓' : '→';
  return `${dir} Next sets ${kg(changed.w)} kg – you had ${s.rir} in reserve, target ${changed.target.rir}`;
}

function prFor(ex, s) {
  const h = S.index.get(key(ex.name));
  if (!h || !h.sessions.length) return null;
  let bestW = h.bestW, bestE = h.bestE, bestReps = h.bestReps;
  for (const o of ex.sets) {
    if (o === s || !o.done || o.type !== 'working') continue;
    if (o.w > bestW && o.r > 0) bestW = o.w;
    const e = R.e1rm(o.w, o.r, o.rir); if (e > bestE) bestE = e;
    if (!(o.w > 0) && o.r > bestReps) bestReps = o.r;
  }
  if (s.w > 0 && s.r > 0) {
    if (bestW > 0 && s.w > bestW) return 'Weight PR';
    const e = s.rir !== null ? R.e1rm(s.w, s.r, s.rir) : null;
    if (e && bestE > 0 && e > bestE + 0.05) return 'Est. 1RM PR';
    return null;
  }
  if (!(s.w > 0) && bestReps > 0 && s.r > bestReps) return 'Rep PR';
  return null;
}

function workoutStats(w) {
  let sets = 0, vol = 0, open = 0;
  const prs = [];
  for (const ex of w.exercises) for (const s of ex.sets) {
    if (s.type !== 'working') continue;
    if (s.done) { sets++; vol += (s.w || 0) * (s.r || 0); if (s.pr) prs.push(`${ex.name} ${kg(s.w)}×${s.r} (${s.pr})`); }
    else open++;
  }
  const mins = Math.round((Date.now() - new Date(w.startedAt)) / 60000);
  return { sets, vol: Math.round(vol), open, prs, mins };
}

async function finishWorkout() {
  const w = S.current;
  const st = workoutStats(w);
  const sets = [];
  for (const ex of w.exercises) {
    let n = 0;
    for (const s of ex.sets) {
      if (s.type !== 'working' || !s.done) continue;
      n++;
      const notes = [];
      if (n === 1 && !(s.w > 0) && !isWeighted(ex.name)) notes.push('BW');
      if (n === 1 && ex.note) notes.push(ex.note);
      if (s.pr) notes.push(s.pr);
      sets.push({ exercise: ex.name, set: n, weight: s.w > 0 ? s.w : null, reps: s.r, rir: s.rir, notes: notes.join('; ') });
    }
  }
  const [pDate, pSession] = w.plannedKey ? w.plannedKey.split('|') : [];
  const checks = ['before', 'after'].map(when => {
    const c = w.checks?.[when];
    if (!c || (!c.items.length && !c.note.trim())) return null;
    return { when, time: c.time, note: c.note.trim(), items: c.items.map(i => ({ area: i.area, name: (i.name || '').trim(), score: i.score })) };
  }).filter(Boolean);
  // Older Apps Script versions only understand hamstring scores; newer ones use `checks` and ignore this.
  const hamstring = checks.flatMap(c => c.items.filter(i => i.area === 'Hamstring').slice(0, 1).map(i => ({ when: c.when, pain: i.score, time: c.time })));
  const op = {
    id: w.id, type: 'session', date: w.date, session: w.session,
    planned: w.plannedKey ? { date: pDate, session: pSession } : null,
    startedAt: w.startedAt, endedAt: new Date().toISOString(), durationMin: st.mins,
    sets, checks, hamstring, prs: st.prs,
  };
  const saved = { id: op.id, date: op.date, session: op.session, sets, savedAt: Date.now() };
  if (testing()) {
    // phone only: no outbox entry, so nothing can reach the sheet
    S.testLocal.push(saved); await kvSet('test:local', S.testLocal);
    if (w.plannedKey) { S.testDone[w.plannedKey] = true; await kvSet('test:done', S.testDone); }
  } else {
    await outboxPut(op);
    S.local.push(saved); await kvSet('local', S.local);
    if (w.plannedKey) { S.done[w.plannedKey] = true; await kvSet('done', S.done); }
  }
  S.lastSummary = { session: w.session, test: testing(), ...st };
  S.current = null; await saveCurrent(true);
  stopRest(); releaseWakeLock();
  buildIndex(); await refreshPending();
  S.view = 'today'; render();
  if (!testing()) await syncAll();
  if (S.updatePending) location.reload();
}

async function skipPlanned(k) {
  const g = plannedGroups().find(x => x.key === k);
  if (!g || !confirm(`Mark "${g.session}" (${fmtDay(g.date)}) as done without logging it?`)) return;
  if (testing()) { S.testDone[k] = true; await kvSet('test:done', S.testDone); render(); return; }
  await outboxPut({ id: uid(), type: 'skipPlanned', date: g.date, session: g.session });
  S.done[k] = true; await kvSet('done', S.done);
  await refreshPending(); render(); syncAll();
}

// ───────────────────────────── rest timer, audio, wake lock ─────────────────────────────

let actx;
function unlockAudio() {
  try {
    if (!actx) {
      if (navigator.audioSession) navigator.audioSession.type = 'transient';   // mix with your music
      actx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (actx.state === 'suspended') actx.resume();
  } catch { /* no audio – the visual cue still works */ }
}

function beep() {
  if (!actx) return;
  const t0 = actx.currentTime;
  [0, 0.28, 0.56].forEach(t => {
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t0 + t);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + t + 0.2);
    o.connect(g).connect(actx.destination);
    o.start(t0 + t); o.stop(t0 + t + 0.22);
  });
}

function startRest(sec) {
  S.rest = { end: Date.now() + sec * 1000, total: sec, fired: false };
  kvSet('rest', S.rest);
  renderRest();
}
function stopRest() { S.rest = { end: 0, total: 0, fired: false }; kvSet('rest', S.rest); renderRest(); }

function renderRest() {
  const el = $('#rest');
  if (!S.rest.end) { el.hidden = true; document.body.classList.remove('resting'); return; }
  const left = Math.ceil((S.rest.end - Date.now()) / 1000);
  el.hidden = false; document.body.classList.add('resting');
  const over = left <= 0;
  el.className = over ? 'go' : '';
  const pct = over ? 100 : 100 - (left / S.rest.total) * 100;
  el.innerHTML = `<div class="rest-bar" style="width:${pct}%"></div>
    <span class="rest-time">${over ? 'Go – next set' : 'Rest ' + mmss(left)}</span>
    <button data-act="rest-adj" data-d="-15">−15</button><button data-act="rest-adj" data-d="15">+15</button>
    <button data-act="rest-stop">${over ? 'OK' : 'Skip'}</button>`;
}

function tickRest() {
  if (!S.rest.end) return;
  const left = Math.ceil((S.rest.end - Date.now()) / 1000);
  if (left <= 0 && !S.rest.fired) {
    S.rest.fired = true;
    beep(); navigator.vibrate?.([300, 120, 300]);
    setTimeout(() => { if (S.rest.fired) stopRest(); }, 8000);
  }
  renderRest();
}

let wakeLock = null;
async function requestWakeLock() {
  if (!S.current || !S.settings.keepAwake || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* not allowed – ignore */ }
}
function releaseWakeLock() { wakeLock?.release?.(); wakeLock = null; }

// ───────────────────────────── sync ─────────────────────────────

async function api(action, payload = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(S.settings.url, {
      method: 'POST', redirect: 'follow', signal: ctrl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // "simple" request → no CORS preflight
      body: JSON.stringify({ token: S.settings.token, action, ...payload }),
    });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || 'Server error');
    return j;
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Timed out (weak signal?)' : e.message);
  } finally { clearTimeout(timer); }
}

async function refreshPending() { S.pending = (await outboxAll()).length; }

async function syncAll({ quiet = true } = {}) {
  if (S.syncing || !S.settings.url || !S.settings.token) return;
  S.syncing = true; renderStatus();
  try {
    const ops = await outboxAll();
    if (ops.length) {
      const r = await api('sync', { ops });
      for (const id of r.applied) await outboxDelete(id);
    }
    const data = await api('bootstrap');
    data.fetchedAt = Date.now();
    S.data = data; await kvSet('data', data);
    // phone-only sessions are now in the sheet history unless still queued
    const queued = new Set((await outboxAll()).map(o => o.id));
    S.local = S.local.filter(l => queued.has(l.id)); await kvSet('local', S.local);
    const live = new Set((data.planned || []).map(r => `${r.date}|${r.session}`));
    for (const k of Object.keys(S.done)) if (!live.has(k)) delete S.done[k];
    await kvSet('done', S.done);
    S.lastSync = Date.now(); S.lastError = null; await kvSet('lastSync', S.lastSync);
    buildIndex();
    if (!quiet) toast('Synced with your Google Sheet ✓');
  } catch (e) {
    S.lastError = e.message;
    if (!quiet) toast(`Sync failed: ${esc(e.message)}<br>Your data is safe on the phone and will retry.`, 6000);
  } finally {
    S.syncing = false; await refreshPending();
    // don't yank inputs out from under you mid-set
    if (S.view !== 'workout' && S.view !== 'finish') render(); else renderStatus();
  }
}

// ───────────────────────────── rendering ─────────────────────────────

function render() {
  renderStatus();
  const tabs = [['today', 'Today'], ...(S.current ? [['workout', 'Workout']] : []), ['progress', 'Progress'], ['settings', 'Settings']];
  if (S.view === 'workout' && !S.current) S.view = 'today';
  $('#tabs').innerHTML = tabs.map(([v, l]) => `<button data-act="nav" data-v="${v}" class="${S.view === v || (v === 'workout' && S.view === 'finish') ? 'on' : ''}">${l}</button>`).join('');
  const views = { today: viewToday, workout: viewWorkout, finish: viewFinish, progress: viewProgress, settings: viewSettings, log: viewLog, psum: viewSummary };
  $('#view').innerHTML = (views[S.view] || viewToday)();
  renderRest();
}

function renderStatus() {
  const online = navigator.onLine;
  const state = !S.settings.url ? 'offline' : S.syncing ? 'syncing' : S.lastError ? 'error' : S.pending ? 'pending' : online ? 'ok' : 'offline';
  const label = S.syncing ? 'Syncing…' : S.pending ? `${S.pending} to sync` : S.lastError ? 'Not synced' : S.lastSync ? `Synced ${ago(S.lastSync)}` : 'Not connected';
  document.body.classList.toggle('testing', testing());
  $('#top').innerHTML = `<h1>Gym Log${testing() ? ' <span class="testpill">TEST</span>' : ''}</h1><button class="sync ${state}" data-act="sync">${!online ? 'Offline · ' : ''}${label}</button>`;
}

function viewToday() {
  let h = '';
  if (testing()) {
    h += `<section class="card test"><h2>Test mode is on</h2><p>Workouts and "Mark done" stay on this phone and are never sent to your sheet. Real unsynced workouts are untouched.</p>
      <div class="row"><button class="btn" data-act="test-off">Exit test mode</button></div></section>`;
  }
  h += `<section class="card"><div class="row between"><h3>Physio log</h3><div><button class="btn sm ghost" data-act="psum-open">Summary</button> <button class="btn primary sm" data-act="plog-open">+ Log how you feel</button></div></div></section>`;
  if (!S.settings.url || !S.settings.token) {
    h += `<section class="card warn"><h2>Connect your sheet</h2><p>Paste the setup code from Apps Script in <b>Settings</b> so workouts sync to your tracker. You can still log offline in the meantime.</p><button class="btn" data-act="nav" data-v="settings">Open Settings</button></section>`;
  }
  if (S.lastSummary) {
    const s = S.lastSummary;
    h += `<section class="card good"><h2>Saved: ${esc(s.session)}</h2><p>${s.sets} working sets · ${s.vol.toLocaleString()} kg · ${s.mins} min</p>
      ${s.prs.length ? `<p>🏆 ${s.prs.map(esc).join('<br>🏆 ')}</p>` : ''}<p class="muted small">${s.test ? 'Test workout: kept on this phone only, not sent to your sheet.' : S.pending ? 'Waiting for signal to sync – it is stored on the phone.' : 'Synced to your sheet.'}</p></section>`;
  }
  if (S.current) {
    const st = workoutStats(S.current);
    h += `<section class="card accent"><h2>In progress: ${esc(S.current.session)}</h2><p>${st.sets} sets done · ${st.open} to go · started ${hhmm(new Date(S.current.startedAt))}</p><button class="btn primary" data-act="nav" data-v="workout">Resume workout</button></section>`;
  }
  const groups = plannedGroups();
  if (groups.length) {
    const [next, ...rest] = groups;
    h += `<section class="card"><p class="eyebrow">Next planned · ${fmtDay(next.date)} (${relDays(next.date)})</p><h2>${esc(next.session)}</h2>${planSummary(next)}
      <div class="row">${S.current ? '' : `<button class="btn primary" data-act="start-plan" data-k="${esc(next.key)}">Start</button>`}<button class="btn ghost" data-act="skip-plan" data-k="${esc(next.key)}">Mark done</button></div></section>`;
    if (rest.length) {
      h += `<section class="card"><h3>Also planned</h3>${rest.map(g => `<div class="li"><div><b>${esc(g.session)}</b><br><span class="muted small">${fmtDay(g.date)}</span></div>
        <div>${S.current ? '' : `<button class="btn sm" data-act="start-plan" data-k="${esc(g.key)}">Start</button>`}<button class="btn sm ghost" data-act="skip-plan" data-k="${esc(g.key)}">Done</button></div></div>`).join('')}</section>`;
    }
  } else if (S.data) {
    h += `<section class="card"><h2>No planned sessions</h2><p class="muted">Nothing in the Planned tab that isn't Done. Ask Claude to plan your next sessions, or start an empty workout.</p></section>`;
  }
  if (!S.current) {
    h += `<section class="card"><h3>Freestyle</h3><div class="row"><input id="free-name" placeholder="Session name, e.g. Upper Pull" value="" autocomplete="off"><button class="btn" data-act="start-free">Start</button></div></section>`;
  }
  return h;
}

function planSummary(g) {
  const ex = new Map();
  for (const r of g.rows) {
    if (r.type !== 'working') continue;
    const k = r.order ?? r.exercise;
    if (!ex.has(k)) ex.set(k, { name: r.exercise, n: 0, w: r.weight, reps: r.reps, rir: r.rir });
    ex.get(k).n++;
  }
  const warm = g.rows.filter(r => r.type === 'warmup').length;
  return `<ul class="plan">${warm ? `<li class="muted">${warm} warm-up drills</li>` : ''}${[...ex.values()].map(e =>
    `<li><b>${esc(e.name)}</b> <span class="muted">${e.n}×${e.reps ?? '?'}${e.w ? ` @ ${kg(e.w)} kg` : ''}${e.rir ? ` · RIR ${esc(e.rir)}` : ''}</span></li>`).join('')}</ul>`;
}

const CHECK_AREAS = ['Hamstring', 'Knee/quad', 'Lower back', 'Other'];

/** Before/after check: score any area 0-10 and note anything else. Written to the Physio Diary. */
function checkCard(when) {
  const c = S.current.checks[when] || { items: [], note: '' };
  const items = c.items.map((it, i) => `<div class="chk-item">
      <div class="row between">${it.area === 'Other'
        ? `<input class="chk-name" data-bind="chk:${when}:${i}:name" value="${esc(it.name || '')}" placeholder="Which area? e.g. left shin" autocomplete="off">`
        : `<b>${esc(it.area)}</b>`}<span class="chk-val">${it.score}/10</span><button class="btn sm ghost" data-act="chk-rm" data-w="${when}" data-i="${i}" aria-label="Remove">✕</button></div>
      <input type="range" min="0" max="10" step="0.5" value="${it.score}" data-bind="chk:${when}:${i}:score"></div>`).join('');
  return `<section class="card chk"><h3>Body check – ${when}</h3>
    <p class="muted small">Tap an area to score it (0 = fine). Add as many as you need.</p>
    <div class="chips">${CHECK_AREAS.map(a => `<button class="chip-btn" data-act="chk-add" data-w="${when}" data-a="${a}">+ ${a}</button>`).join('')}</div>
    ${items}
    <textarea rows="2" data-bind="chknote:${when}" placeholder="Anything else? e.g. right knee stiff on stairs">${esc(c.note)}</textarea>
    <p class="muted small">${testing() ? 'Test mode: not sent' : 'Saved to the Physio Diary'}</p></section>`;
}

const ensureCheck = when => (S.current.checks[when] ||= { items: [], note: '', time: hhmm() });

function viewWorkout() {
  const w = S.current;
  let h = `<div class="wk-head"><div><h2>${esc(w.session)}</h2><span class="muted small" id="elapsed"></span></div><button class="btn primary" data-act="finish">Finish</button></div>`;
  if (S.settings.hamstring) h += checkCard('before');
  if (w.warmups.length) {
    h += `<section class="card"><h3>Warm-up</h3>${w.warmups.map((x, i) => `<label class="check ${x.done ? 'done' : ''}"><input type="checkbox" data-act="warm" data-i="${i}" ${x.done ? 'checked' : ''}> ${esc(x.text)}</label>`).join('')}</section>`;
  }
  w.exercises.forEach((ex, ei) => { h += exerciseCard(ex, ei); });
  h += `<section class="card"><h3>Add exercise</h3><div class="row"><input id="add-ex" list="exlist" placeholder="Search or type a new one" autocomplete="off"><button class="btn" data-act="add-ex">Add</button></div>
    <datalist id="exlist">${[...new Set([...(S.data?.exercises || []), ...[...S.index.values()].map(e => e.name)])].sort().map(n => `<option value="${esc(n)}">`).join('')}</datalist></section>`;
  h += `<button class="btn danger block" data-act="discard">Discard workout</button>`;
  return h;
}

function exerciseCard(ex, ei) {
  const last = lastTime(ex.name);
  const step = R.stepFor(ex.name, S.settings);
  const allDone = ex.sets.length && ex.sets.every(s => s.done);
  let h = `<section class="card ex ${allDone ? 'complete' : ''}"><div class="row between"><h3>${esc(ex.name)}</h3><span class="muted small">±${step} kg</span></div>`;
  if (ex.cue) h += `<p class="cue">${esc(ex.cue)}</p>`;
  const info = muscleInfo(ex.name);
  if (info) {
    h += `<button class="feel-toggle" data-act="feel" data-ex="${ei}" aria-expanded="${!!ex.showFeel}">${ex.showFeel ? '▾' : '▸'} Where to feel it</button>`;
    if (ex.showFeel) {
      const ml = muscleList(info.m);
      h += `<div class="feel">${bodyMap(info.m)}
        <div class="legend"><span class="key l3">Main</span><span class="key l2">Assisting</span><span class="key l1">Stabilising</span></div>
        <p><b>Feel it:</b> ${esc(info.feel)}</p><p><b>Not here:</b> ${esc(info.not)}</p>
        <p class="muted small">Main: ${ml.main.join(', ') || '–'}${ml.assist.length ? ` · Assisting: ${ml.assist.join(', ')}` : ''}${ml.stabilise.length ? ` · Stabilising: ${ml.stabilise.join(', ')}` : ''}</p></div>`;
    }
  }
  if (last) h += `<p class="last"><span>Last · ${fmtShort(last.date)}</span> ${esc(last.text)}</p>`;
  if (ex.hint && !ex.sets.some(s => s.type === 'working' && s.done)) {
    const first = ex.sets.find(s => s.type === 'working');
    h += `<button class="chip" data-act="hint" data-ex="${ei}">Engine: ${kg(ex.hint.w)} kg${first?.w ? ` (plan ${kg(first.w)})` : ''} · from ${fmtShort(ex.hint.date)}, est. 1RM ${Math.round(ex.hint.e)} – apply</button>`;
  }
  h += `<div class="sets"><div class="set hdr"><span>Set</span><span>kg</span><span>Reps</span><span>RIR</span><span></span></div>`;
  let wn = 0, rn = 0;
  ex.sets.forEach((s, si) => {
    const lbl = s.type === 'ramp' ? `W${++rn}` : `${++wn}`;
    const cls = `set ${s.type} ${s.done ? 'done' : ''} ${s.pr ? 'pr' : ''}`;
    if (s.type === 'ramp') {
      h += `<div class="${cls}"><span class="lbl">${lbl}</span><span class="ro">${kg(s.w)}</span><span class="ro">${s.r ?? ''}</span><span class="ro muted small">${s.auto ? 'auto' : 'ramp'}</span>
        <button class="tick" data-act="tick" data-ex="${ei}" data-s="${si}" aria-label="Done">${s.done ? '✓' : ''}</button></div>`;
    } else {
      const b = f => `data-bind="set:${ei}:${si}:${f}"`;
      h += `<div class="${cls}"><span class="lbl">${lbl}</span>
        <input type="number" inputmode="decimal" step="any" ${b('w')} value="${s.w ?? ''}" placeholder="${isWeighted(ex.name) ? 'kg' : 'BW'}">
        <input type="number" inputmode="numeric" ${b('r')} value="${s.r ?? ''}" placeholder="${s.tr ?? ''}">
        <input type="number" inputmode="decimal" step="0.5" ${b('rir')} value="${s.rir ?? ''}" placeholder="${s.trir !== null ? '@' + s.trir : '–'}">
        <button class="tick" data-act="tick" data-ex="${ei}" data-s="${si}" aria-label="Done">${s.done ? '✓' : ''}</button></div>`;
      if (s.pr) h += `<div class="setnote pr">🏆 ${esc(s.pr)}</div>`;
      else if (s.adj && !s.done) h += `<div class="setnote">${s.w > (s.adj.from || 0) ? '↑' : '↓'} adjusted from ${kg(s.adj.from)} by RIR</div>`;
    }
  });
  h += `</div><div class="row ex-actions"><button class="btn sm ghost" data-act="add-set" data-ex="${ei}">+ Set</button>`;
  if (!ex.sets.some(s => s.type === 'ramp')) h += `<button class="btn sm ghost" data-act="add-ramps" data-ex="${ei}">+ Warm-ups</button>`;
  h += `<button class="btn sm ghost" data-act="note" data-ex="${ei}">${ex.note ? 'Edit note' : 'Note'}</button><button class="btn sm ghost" data-act="rm-ex" data-ex="${ei}">Remove</button></div>`;
  if (ex.showNote || ex.note) h += `<textarea rows="2" data-bind="note:${ei}" placeholder="How did it feel? (saved to Notes on set 1)">${esc(ex.note)}</textarea>`;
  return h + '</section>';
}

function viewFinish() {
  const st = workoutStats(S.current);
  let h = `<section class="card"><h2>Finish ${esc(S.current.session)}?</h2><p>${st.sets} working sets · ${st.vol.toLocaleString()} kg volume · ${st.mins} min</p>
    ${st.prs.length ? `<p>🏆 ${st.prs.map(esc).join('<br>🏆 ')}</p>` : ''}
    ${st.open ? `<p class="warn-text">${st.open} working set${st.open > 1 ? 's are' : ' is'} not ticked and won't be saved.</p>` : ''}</section>`;
  if (S.settings.hamstring) h += checkCard('after');
  const otherAreas = ['before', 'after'].some(w => S.current.checks[w]?.items.some(i => i.area !== 'Hamstring'));
  if (otherAreas && !testing() && S.data && !(S.data.api >= 2)) {
    h += `<p class="warn-text small">Your Apps Script needs the latest Code.gs to save knee, back and other scores. Until then only hamstring scores reach the sheet.</p>`;
  }
  if (testing()) h += `<p class="muted small">Test mode: this stays on your phone and is not sent to your sheet.</p>`;
  h += `<button class="btn primary block" data-act="save">${testing() ? 'Save test workout' : 'Save workout'}</button><button class="btn ghost block" data-act="nav" data-v="workout">Back to workout</button>`;
  return h;
}

function viewProgress() {
  const all = [...S.index.values()].filter(e => e.sessions.length).sort((a, b) => b.last.localeCompare(a.last));
  if (!all.length) return `<section class="card"><h2>No history yet</h2><p class="muted">Connect your sheet in Settings to load your Workout Log.</p></section>`;
  const sel = S.index.get(key(S.progress.ex)) || all[0];
  S.progress.ex = sel.name;
  const since = S.progress.range ? dayStr(new Date(Date.now() - S.progress.range * 86400000)) : '0000';
  const sessions = sel.sessions.filter(s => s.date >= since);
  const weighted = sel.bestW > 0;
  let series;
  if (weighted) {
    const e = [], top = [];
    for (const s of sessions) {
      const t = parseDay(s.date).getTime();
      const be = Math.max(0, ...s.sets.map(x => R.e1rm(x.w, x.r, x.rir) || 0));
      const tw = Math.max(0, ...s.sets.map(x => x.w || 0));
      if (be) e.push({ x: t, y: Math.round(be * 10) / 10 });
      if (tw) top.push({ x: t, y: tw });
    }
    series = [{ name: 'Est. 1RM', cls: 's1', points: e }, { name: 'Top set', cls: 's2', points: top }];
  } else {
    series = [{ name: 'Best reps', cls: 's1', points: sessions.map(s => ({ x: parseDay(s.date).getTime(), y: Math.max(...s.sets.map(x => x.r || 0)) })) },
      { name: 'Total reps', cls: 's2', points: sessions.map(s => ({ x: parseDay(s.date).getTime(), y: s.sets.reduce((t, x) => t + (x.r || 0), 0) })) }];
  }
  let h = `<section class="card"><select data-act="pick-ex">${all.map(e => `<option ${e === sel ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
    <div class="seg">${[[90, '3M'], [180, '6M'], [365, '1Y'], [0, 'All']].map(([d, l]) => `<button data-act="range" data-d="${d}" class="${S.progress.range === d ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${lineChart(series, { unit: weighted ? ' kg' : '' })}
    <div class="stats">${weighted ? `<div><b>${kg(sel.bestW)} kg</b><span>heaviest${sel.bestWDate ? ' · ' + fmtShort(sel.bestWDate) : ''}</span></div><div><b>${Math.round(sel.bestE)} kg</b><span>best est. 1RM</span></div>` : `<div><b>${sel.bestReps}</b><span>best reps</span></div>`}
    <div><b>${sel.sessions.length}</b><span>sessions</span></div></div></section>`;
  h += `<section class="card"><h3>Recent sessions</h3>${sel.sessions.slice(-8).reverse().map(s => `<div class="li col"><span class="muted small">${fmtDay(s.date)} · ${esc(s.session)}</span><span>${s.sets.map(x => `${kgFor(x.w, sel.name)}×${x.r || '?'}${x.rir !== null ? ' @' + x.rir : ''}`).join(' · ')}</span></div>`).join('')}</section>`;
  h += `<section class="card"><h3>Recent PRs (heaviest weight)</h3>${recentPrs().map(p => `<div class="li"><span>${esc(p.name)}</span><span><b>${kg(p.w)} kg</b> <span class="muted small">${fmtShort(p.date)}</span></span></div>`).join('') || '<p class="muted small">None yet.</p>'}</section>`;
  return h;
}

function recentPrs() {
  const ev = [];
  for (const e of S.index.values()) {
    let best = 0;
    for (const s of e.sessions) {
      const top = Math.max(0, ...s.sets.filter(x => x.r > 0).map(x => x.w || 0));
      if (top > best) { if (best > 0) ev.push({ name: e.name, w: top, date: s.date }); best = top; }
    }
  }
  return ev.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
}

function viewSettings() {
  const st = S.settings;
  const tog = (k, label, help) => `<label class="tog"><input type="checkbox" data-setting="${k}" ${st[k] ? 'checked' : ''}><span><b>${label}</b><br><span class="muted small">${help}</span></span></label>`;
  const numIn = (k, label) => `<label class="field"><span>${label}</span><input type="number" inputmode="decimal" step="any" data-setting="${k}" value="${st[k]}"></label>`;
  const testCount = S.testLocal.length + S.testPhysio.length;
  return `<section class="card ${testing() ? 'test' : ''}"><h2>Test mode</h2>
      <label class="tog"><input type="checkbox" data-act="test-toggle" ${testing() ? 'checked' : ''}><span><b>Practise without saving to the sheet</b><br><span class="muted small">Adds a practice session. Test workouts stay on this phone, and your real data and unsynced workouts are kept separately.</span></span></label>
      ${testCount ? `<div class="row"><span class="muted small">${testCount} test entr${testCount > 1 ? 'ies' : 'y'} saved</span><button class="btn sm ghost" data-act="clear-test">Clear test data</button></div>` : ''}</section>
    <section class="card"><h2>Google Sheet connection</h2>
      <label class="field"><span>Setup code (paste from Apps Script)</span><textarea id="setup-code" rows="2" placeholder="GYMLOG:…"></textarea></label>
      <button class="btn" data-act="apply-code">Use setup code</button>
      <details ${st.url ? '' : 'open'}><summary class="muted small">Or enter manually</summary>
        <label class="field"><span>Web app URL</span><input data-setting="url" value="${esc(st.url)}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
        <label class="field"><span>Token</span><input data-setting="token" value="${esc(st.token)}" autocomplete="off"></label>
      </details>
      <div class="row"><button class="btn primary" data-act="sync-now">Sync now</button></div>
      <p class="muted small">${S.pending} change(s) waiting · ${S.lastSync ? 'last synced ' + ago(S.lastSync) : 'never synced'}${S.lastError ? ` · last error: ${esc(S.lastError)}` : ''}</p></section>
    <section class="card"><h2>Workout</h2>
      ${tog('autoAdjust', 'Auto-adjust weights by RIR', 'After each working set, re-target the remaining sets (max +5 % / −10 %).')}
      ${tog('autoWarmups', 'Automatic warm-up ramps', 'Adds bar → 50 → 70 → 85 % sets to heavy barbell lifts with no ramp planned.')}
      ${tog('hamstring', 'Body check-in', 'Before/after scores for any area (hamstring, knee, back…) plus notes, written to the Physio Diary.')}
      ${tog('keepAwake', 'Keep screen on', 'During a workout, so the rest timer stays visible.')}
      ${numIn('defaultRest', 'Default rest (s)')}${numIn('stepBarbell', 'Barbell increment (kg)')}${numIn('stepDumbbell', 'Dumbbell increment (kg)')}${numIn('stepOther', 'Machine/cable increment (kg)')}</section>
    <section class="card"><h2>Data</h2><p class="muted small">Everything is stored on this phone first and sent to the sheet when there is signal.</p>
      <button class="btn ghost" data-act="export">Export backup (JSON)</button>
      <p class="muted small" id="persist"></p>
      <div class="row"><span class="muted small">Gym Log v${VERSION}</span><button class="btn sm ghost" data-act="check-update">Check for update</button></div>
      <p class="muted small">Body diagrams: react-native-body-highlighter, MIT licence, © 2022 ELABBASSI Hicham.</p></section>`;
}

// ───────────────────────────── events ─────────────────────────────

const actions = {
  nav: d => { S.view = d.v; render(); window.scrollTo(0, 0); },
  sync: () => syncAll({ quiet: false }),
  'sync-now': () => syncAll({ quiet: false }),
  'start-plan': d => {
    const g = plannedGroups().find(x => x.key === d.k);
    if (!g) return;
    S.current = workoutFromPlan(g); S.lastSummary = null; startWorkoutUi();
  },
  'skip-plan': d => skipPlanned(d.k),
  'test-off': () => setTestMode(false),
  'clear-test': async () => {
    if (!confirm('Delete all test workouts from this phone? Your real data is not affected.')) return;
    S.testLocal = []; S.testDone = {}; S.testPhysio = [];
    await kvDel('test:local'); await kvDel('test:done'); await kvDel('test:physio');
    if (testing()) { S.current = null; await saveCurrent(true); stopRest(); }
    else await kvDel('test:current');
    buildIndex(); render(); toast('Test data cleared');
  },
  'start-free': () => {
    const name = $('#free-name').value.trim() || 'Freestyle';
    S.current = newWorkout(name); S.lastSummary = null; startWorkoutUi();
  },
  tick: d => tickSet(+d.ex, +d.s),
  warm: d => { const x = S.current.warmups[+d.i]; x.done = !x.done; saveCurrent(); render(); },
  hint: d => {
    const ex = S.current.exercises[+d.ex];
    for (const s of ex.sets) if (s.type === 'working' && !s.done) { s.adj = { from: s.w }; s.w = ex.hint.w; }
    ex.hint = null; saveCurrent(); render();
  },
  'add-set': d => {
    const ex = S.current.exercises[+d.ex];
    const prev = [...ex.sets].reverse().find(s => s.type === 'working');
    ex.sets.push(mkSet('working', prev?.w ?? null, prev?.tr ?? prev?.r ?? null, prev?.trir ?? null, prev?.rest ?? null));
    saveCurrent(); render();
  },
  'add-ramps': d => { if (!addRamps(S.current.exercises[+d.ex], false)) toast('Enter a working weight of 30 kg+ first'); saveCurrent(); render(); },
  note: d => { S.current.exercises[+d.ex].showNote = true; render(); },
  'rm-ex': d => { const ex = S.current.exercises[+d.ex]; if (confirm(`Remove ${ex.name}?`)) { S.current.exercises.splice(+d.ex, 1); saveCurrent(); render(); } },
  'add-ex': () => {
    const v = $('#add-ex').value.trim();
    if (!v) return;
    S.current.exercises.push(exerciseFromHistory(v)); saveCurrent(); render();
  },
  'chk-add': d => {
    const c = ensureCheck(d.w);
    if (d.a !== 'Other' && c.items.some(i => i.area === d.a)) return toast(`${d.a} is already in this check`);
    c.items.push({ area: d.a, name: '', score: 0 }); c.time = hhmm(); saveCurrent(); render();
  },
  'chk-rm': d => { S.current.checks[d.w].items.splice(+d.i, 1); saveCurrent(); render(); },
  feel: d => { const ex = S.current.exercises[+d.ex]; ex.showFeel = !ex.showFeel; saveCurrent(); render(); },
  finish: () => { S.view = 'finish'; render(); window.scrollTo(0, 0); },
  save: () => finishWorkout(),
  discard: async () => { if (!confirm('Discard this workout? Nothing will be saved.')) return; S.current = null; await saveCurrent(true); stopRest(); releaseWakeLock(); S.view = 'today'; render(); },
  'rest-adj': d => { S.rest.end += +d.d * 1000; S.rest.total = Math.max(S.rest.total + +d.d, 1); S.rest.fired = false; kvSet('rest', S.rest); renderRest(); },
  'rest-stop': () => stopRest(),
  'check-update': async () => {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.update();
      if (reg?.installing || reg?.waiting) toast('Downloading the new version…');   // controllerchange reloads
      else toast(`You're on the latest version (v${VERSION})`);
    } catch { toast('Could not check for updates – are you offline?'); }
  },
  range: d => { S.progress.range = +d.d; render(); },
  'apply-code': () => {
    const raw = $('#setup-code').value.trim().replace(/^GYMLOG:/, '');
    try {
      const { u, t } = JSON.parse(atob(raw));
      S.settings.url = u; S.settings.token = t; kvSet('settings', S.settings);
      toast('Connected – syncing…'); render(); syncAll({ quiet: false });
    } catch { toast('That setup code is not valid – copy the whole GYMLOG:… line'); }
  },
  export: async () => {
    const dump = { exportedAt: new Date().toISOString(), version: VERSION, current: S.current, local: S.local, outbox: await outboxAll(), settings: { ...S.settings, token: undefined }, data: S.data };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(dump, null, 1)], { type: 'application/json' }));
    a.download = `gym-log-backup-${dayStr()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
};

/** Switching modes reloads the app so every screen and store comes up in the new mode. */
async function setTestMode(on) {
  if (S.current && !confirm(`Your ${testing() ? 'test' : 'real'} workout in progress will be kept and come back when you switch back. Continue?`)) { render(); return; }
  await saveCurrent(true);
  S.settings.testMode = on; await kvSet('settings', S.settings);
  stopRest();
  location.reload();
}

function startWorkoutUi() {
  saveCurrent(true); S.view = 'workout'; render(); window.scrollTo(0, 0); requestWakeLock(); unlockAudio();
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT') return;
  const fn = actions[el.dataset.act];
  if (fn) { if (el.tagName !== 'INPUT') e.preventDefault(); fn(el.dataset); }
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.act === 'pick-ex') { S.progress.ex = el.value; render(); return; }
  if (el.dataset.act === 'test-toggle') { setTestMode(el.checked); return; }
  if (el.dataset.setting) {
    const k = el.dataset.setting;
    S.settings[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (num(el.value) ?? DEFAULT_SETTINGS[k]) : el.value.trim();
    kvSet('settings', S.settings);
    if (k === 'url' || k === 'token') syncAll({ quiet: false });
  }
});

document.addEventListener('input', e => {
  const b = e.target.dataset.bind;
  if (!b || !S.current) return;
  const [kind, a, c, f] = b.split(':');
  if (kind === 'set') {
    const s = S.current.exercises[+a].sets[+c];
    s[f] = num(e.target.value);
    if (f === 'w') { s.touched = true; s.adj = null; }
  } else if (kind === 'note') {
    S.current.exercises[+a].note = e.target.value;
  } else if (kind === 'chk') {
    const check = ensureCheck(a), it = check.items[+c];
    if (!it) return;
    if (f === 'score') {
      it.score = num(e.target.value) ?? 0;
      const v = e.target.closest('.chk-item')?.querySelector('.chk-val');
      if (v) v.textContent = `${it.score}/10`;
    } else it.name = e.target.value;
    check.time = hhmm();
  } else if (kind === 'chknote') {
    const ch = ensureCheck(a); ch.note = e.target.value; ch.time = hhmm();
  }
  saveCurrent();
});

// Enter on the number pad moves to the next field
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
  const ins = [...document.querySelectorAll('#view input[type=number]')];
  const i = ins.indexOf(e.target);
  if (i >= 0) { e.preventDefault(); (ins[i + 1] || e.target).focus(); }
});

window.addEventListener('online', () => { renderStatus(); syncAll(); });
window.addEventListener('offline', renderStatus);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    tickRest(); requestWakeLock(); if (S.view !== 'workout') syncAll();
    // iPhones resume home-screen apps instead of relaunching them, so look for a new version here too
    navigator.serviceWorker?.getRegistration().then(r => r?.update()).catch(() => { });
  }
});

setInterval(() => {
  tickRest();
  const el = $('#elapsed');
  if (el && S.current) el.textContent = `${mmss(Math.floor((Date.now() - new Date(S.current.startedAt)) / 1000))} elapsed`;
}, 500);
setInterval(() => { if (S.pending && S.view !== 'workout') syncAll(); }, 5 * 60000);

// ───────────────────────────── physio log ─────────────────────────────
// Type or dictate an entry the way you would in Notes; the parsed time, activity and scores fill the form below,
// where anything can be corrected. Saved entries queue like workouts and become Physio Diary rows.

function newLogDraft() {
  return { date: dayStr(), time: hhmm(), text: '', activity: 'General / other', items: [], touched: {}, manual: {} };
}

let draftTimer;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => (S.plog ? kvSet('physioDraft', S.plog) : kvDel('physioDraft')), 300);
}

function logForm() {
  const d = S.plog;
  const items = d.items.map((it, i) => `<div class="chk-item">
      <div class="row between">${it.area === 'Other'
        ? `<input class="chk-name" data-plog="item:${i}:name" value="${esc(it.name || '')}" placeholder="Which area? e.g. left shin" autocomplete="off">`
        : `<b>${esc(it.area)}</b>`}<span class="chk-val">${it.score}/10</span><button class="btn sm ghost" data-act="plog-rm" data-i="${i}" aria-label="Remove">✕</button></div>
      <input type="range" min="0" max="10" step="0.5" value="${it.score}" data-plog="item:${i}:score"></div>`).join('');
  const waiting = !testing() && S.data && !(S.data.api >= 3);
  return `<section class="card"><h3>When</h3><div class="row">
      <input type="date" data-plog="date" value="${esc(d.date)}"><input type="time" data-plog="time" value="${esc(d.time)}"></div></section>
    <section class="card"><h3>What were you doing?</h3><div class="chips">${ACTIVITIES.map(a =>
      `<button class="chip-btn ${d.activity === a.name ? 'on' : ''}" data-act="plog-act" data-a="${esc(a.name)}">${esc(a.short)}</button>`).join('')}</div></section>
    <section class="card"><h3>How does it feel?</h3><p class="muted small">Tap an area to score it (0 = fine).</p>
      <div class="chips">${AREAS.map(a => `<button class="chip-btn" data-act="plog-add" data-a="${a}">+ ${a}</button>`).join('')}</div>${items}</section>
    ${waiting ? `<p class="warn-text small">Your Apps Script needs the latest Code.gs to save log entries. Until then they wait safely on this phone.</p>` : ''}
    ${testing() ? `<p class="muted small">Test mode: this stays on your phone and is not sent to your sheet.</p>` : ''}
    <button class="btn primary block" data-act="plog-save">${testing() ? 'Save test entry' : 'Save'}</button>`;
}

function viewLog() {
  if (!S.plog) S.plog = newLogDraft();
  return `<div class="wk-head"><h2>Log how you feel</h2><button class="btn sm ghost" data-act="plog-cancel">Cancel</button></div>
    <section class="card"><label class="field" style="margin:0"><span>Describe it like a note, or dictate with the keyboard mic</span>
      <textarea id="plog-text" rows="3" data-plog="text" placeholder="sat on bus 40 mins hamstring 2.5/10, knees 1.5">${esc(S.plog.text)}</textarea></label>
      <p class="muted small" id="plog-hint">${S.plog.text.trim() ? 'Filled in below. Tap anything to change it.' : 'Or skip this and use the form below.'}</p></section>
    <div id="plog-form">${logForm()}</div>`;
}

const renderLogForm = () => { const el = $('#plog-form'); if (el) el.innerHTML = logForm(); };

const itemKey = i => (i.area === 'Other' ? `Other:${(i.name || '').trim().toLowerCase()}` : i.area);

/** Apply what the parser understood, without overriding anything changed by hand (tracked per area). */
function applyParse() {
  const d = S.plog, r = parseLog(d.text);
  d.manual ||= {};
  if (!d.touched.time && r.time) d.time = r.time;
  if (!d.touched.activity) d.activity = r.activity;
  const items = [];
  for (const p of r.items) {
    const k = itemKey(p);
    if (d.manual[k] === 'removed') continue;
    const cur = d.items.find(i => itemKey(i) === k);
    items.push(d.manual[k] === 'edited' && cur ? cur : p);
  }
  for (const cur of d.items) if (d.manual[itemKey(cur)] === 'edited' && !items.includes(cur)) items.push(cur);
  d.items = items;
  const hint = $('#plog-hint');
  if (hint) hint.textContent = d.text.trim() ? 'Filled in below. Tap anything to change it.' : 'Or skip this and use the form below.';
}

async function saveLog() {
  const d = S.plog;
  const note = parseLog(d.text).note;   // the text without a leading time, which has its own field
  if (!note && !d.items.length) return toast('Add a score or describe how it feels first');
  const entry = { id: uid(), date: d.date || dayStr(), time: d.time || '', activity: d.activity,
    items: d.items.map(i => ({ area: i.area, name: (i.name || '').trim(), score: i.score })), note };
  if (testing()) {
    S.testPhysio.push(entry); await kvSet('test:physio', S.testPhysio);
  } else {
    await outboxPut({ ...entry, type: 'physio' });
  }
  S.plog = null; await kvDel('physioDraft');
  await refreshPending();
  S.view = 'today'; render(); window.scrollTo(0, 0);
  toast(testing() ? 'Test entry saved on this phone' : 'Logged – it will sync to the Physio Diary');
  if (!testing()) syncAll();
}

Object.assign(actions, {
  'plog-open': () => {
    if (!S.plog) S.plog = newLogDraft();
    else if (!S.plog.text.trim() && !S.plog.items.length) S.plog = newLogDraft();   // stale empty draft: start fresh
    S.view = 'log'; render(); window.scrollTo(0, 0); $('#plog-text')?.focus();
  },
  'plog-cancel': () => {
    if ((S.plog?.text.trim() || S.plog?.items.length) && !confirm('Discard this entry?')) return;
    S.plog = null; kvDel('physioDraft'); S.view = 'today'; render();
  },
  'plog-act': d => { S.plog.activity = d.a; S.plog.touched.activity = true; saveDraft(); renderLogForm(); },
  'plog-add': d => {
    if (d.a !== 'Other' && S.plog.items.some(i => i.area === d.a)) return toast(`${d.a} is already in this entry`);
    const it = { area: d.a, name: '', score: 0 };
    S.plog.items.push(it); (S.plog.manual ||= {})[itemKey(it)] = 'edited'; saveDraft(); renderLogForm();
  },
  'plog-rm': d => {
    const [it] = S.plog.items.splice(+d.i, 1);
    if (it) (S.plog.manual ||= {})[itemKey(it)] = 'removed';
    saveDraft(); renderLogForm();
  },
  'plog-save': () => saveLog(),
});

document.addEventListener('input', e => {
  const b = e.target.dataset.plog;
  if (!b || !S.plog) return;
  const [kind, i, f] = b.split(':');
  if (kind === 'text') { S.plog.text = e.target.value; applyParse(); renderLogForm(); }
  else if (kind === 'date' || kind === 'time') { S.plog[kind] = e.target.value; S.plog.touched[kind] = true; }
  else if (kind === 'item') {
    const it = S.plog.items[+i];
    if (!it) return;
    if (f === 'score') {
      it.score = num(e.target.value) ?? 0;
      const v = e.target.closest('.chk-item')?.querySelector('.chk-val');
      if (v) v.textContent = `${it.score}/10`;
    } else it.name = e.target.value;
    (S.plog.manual ||= {})[itemKey(it)] = 'edited';
  }
  saveDraft();
});

// ───────────────────────────── physio summary ─────────────────────────────
// Built from the Physio Diary (sent by the Apps Script) plus entries still waiting on the phone,
// as plain text that can be copied or shared with the physio.

function summaryData() {
  const fromSheet = diaryEntries(S.data?.physio || []);
  const inSheet = new Set(fromSheet.map(e => e.id).filter(Boolean));
  const extra = [...S.psum.queued, ...(testing() ? S.testPhysio : [])].filter(e => !inSheet.has(e.id)).map(appEntry);
  const workouts = [
    ...(S.data?.history || []).map(h => ({ date: h[0], session: h[1] })),
    ...S.local.map(l => ({ date: l.date, session: l.session })),
    ...(testing() ? S.testLocal.map(l => ({ date: l.date, session: `${l.session} (test)` })) : []),
  ];
  return summarise([...fromSheet, ...extra], { days: S.psum.days, today: dayStr(), workouts });
}

function viewSummary() {
  const sum = summaryData();
  const text = summaryText(sum);
  const tiles = sum.areas.filter(a => a.n && ['Hamstring', 'Knee/quad', 'Lower back'].includes(a.area)).map(a => `<div><b>${a.avg}</b><span>${esc(a.area)} avg · worst ${a.worst.score}</span></div>`).join('');
  const noDiary = !S.data?.physio;
  return `<div class="wk-head"><h2>Physio summary</h2><button class="btn sm ghost" data-act="nav" data-v="today">Close</button></div>
    <section class="card"><div class="seg">${[[7, '1 week'], [14, '2 weeks'], [28, '4 weeks']].map(([d, l]) =>
      `<button data-act="psum-days" data-d="${d}" class="${S.psum.days === d ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${tiles ? `<div class="stats">${tiles}</div>` : ''}</section>
    ${noDiary ? `<p class="warn-text small">Update the Apps Script to include your Physio Diary here. Until then only entries waiting on this phone are shown.</p>` : ''}
    <section class="card"><div class="summary-text" id="psum-text">${esc(text)}</div></section>
    <div class="row"><button class="btn ghost" style="flex:1" data-act="psum-copy">Copy</button>
      ${navigator.share ? `<button class="btn primary" style="flex:1" data-act="psum-share">Share</button>` : ''}</div>`;
}

Object.assign(actions, {
  'psum-open': async () => {
    S.psum.queued = (await outboxAll()).filter(o => o.type === 'physio');
    S.view = 'psum'; render(); window.scrollTo(0, 0);
  },
  'psum-days': d => { S.psum.days = +d.d; render(); },
  'psum-copy': async () => {
    try { await navigator.clipboard.writeText(summaryText(summaryData())); toast('Summary copied'); }
    catch { toast('Could not copy – select the text and copy it instead'); }
  },
  'psum-share': async () => {
    try { await navigator.share({ title: 'Physio summary', text: summaryText(summaryData()) }); }
    catch (e) { if (e?.name !== 'AbortError') toast('Could not open sharing'); }
  },
});

// ───────────────────────────── boot ─────────────────────────────

async function boot() {
  S.settings = { ...DEFAULT_SETTINGS, ...(await kvGet('settings') || {}) };
  S.data = await kvGet('data') || null;
  S.current = await kvGet(currentKey()) || null;
  if (S.current && !S.current.checks) {   // started before v8: convert the hamstring-only check
    const old = S.current.hamstring || {};
    const conv = v => (v ? { items: [{ area: 'Hamstring', name: '', score: v.pain ?? 0 }], note: '', time: v.time || hhmm() } : null);
    S.current.checks = { before: conv(old.before), after: conv(old.after) };
    delete S.current.hamstring;
  }
  S.testLocal = await kvGet('test:local') || [];
  S.testDone = await kvGet('test:done') || {};
  S.testPhysio = await kvGet('test:physio') || [];
  S.plog = await kvGet('physioDraft') || null;
  S.local = await kvGet('local') || [];
  S.done = await kvGet('done') || {};
  S.lastSync = await kvGet('lastSync') || null;
  S.rest = await kvGet('rest') || S.rest;
  if (S.rest.end && S.rest.end < Date.now() - 60000) S.rest = { end: 0, total: 0, fired: false };
  await refreshPending();
  buildIndex();
  if (S.current) S.view = 'workout';
  render();
  requestWakeLock();
  syncAll();

  if (navigator.storage?.persist) {
    const ok = await navigator.storage.persist().catch(() => false);
    const el = $('#persist'); if (el) el.textContent = ok ? 'Storage: persistent ✓' : 'Storage: best-effort';
  }
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => { });
    // A new version has taken over: switch to it now, unless a workout is open.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      if (S.current) { S.updatePending = true; toast('Update downloaded – it will load after this workout', 6000); }
      else location.reload();
    });
  }
}

boot();
