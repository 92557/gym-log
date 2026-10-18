import { kvGet, kvSet, kvDel, outboxAll, outboxPut, outboxDelete } from './db.js';
import * as R from './rir.js';
import { lineChart } from './charts.js';

const VERSION = '1.0.0';
const DEFAULT_SETTINGS = {
  url: '', token: '',
  hamstring: true,          // before/after check-in → Physio Diary
  autoWarmups: true,        // add a ramp to heavy barbell lifts that have none planned
  autoAdjust: true,         // RIR engine changes the next sets' weight mid-session
  keepAwake: true,          // screen stays on during a workout
  defaultRest: 90,
  stepBarbell: 2.5, stepDumbbell: 2, stepOther: 2.5,
};

const S = {
  settings: { ...DEFAULT_SETTINGS },
  data: null,               // last bootstrap from the sheet
  current: null,            // in-progress workout
  local: [],                // sessions saved on the phone but not yet visible in `data`
  done: {},                 // planned-session keys finished/skipped locally
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
  const go = () => (S.current ? kvSet('current', S.current) : kvDel('current'));
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
  return [...groups.values()].filter(g => !S.done[g.key]).sort((a, b) => a.date.localeCompare(b.date));
}

function mkSet(type, tw, tr, trir, rest) {
  return { id: uid(), type, tw: tw ?? null, tr: tr ?? null, trir: trir ?? null, rest: rest ?? null,
    w: tw ?? null, r: tr ?? null, rir: null, done: false, pr: null, adj: null, touched: false, auto: false };
}

function newWorkout(session, plannedKey = null) {
  return { id: uid(), session, plannedKey, date: dayStr(), startedAt: new Date().toISOString(),
    hamstring: { before: null, after: null }, warmups: [], exercises: [] };
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
  const hamstring = ['before', 'after'].map(when => w.hamstring[when] && { when, ...w.hamstring[when] }).filter(Boolean);
  const op = {
    id: w.id, type: 'session', date: w.date, session: w.session,
    planned: w.plannedKey ? { date: pDate, session: pSession } : null,
    startedAt: w.startedAt, endedAt: new Date().toISOString(), durationMin: st.mins,
    sets, hamstring, prs: st.prs,
  };
  await outboxPut(op);
  S.local.push({ id: op.id, date: op.date, session: op.session, sets, savedAt: Date.now() });
  await kvSet('local', S.local);
  if (w.plannedKey) { S.done[w.plannedKey] = true; await kvSet('done', S.done); }
  S.lastSummary = { session: w.session, ...st };
  S.current = null; await saveCurrent(true);
  stopRest(); releaseWakeLock();
  buildIndex(); await refreshPending();
  S.view = 'today'; render();
  syncAll();
}

async function skipPlanned(k) {
  const g = plannedGroups().find(x => x.key === k);
  if (!g || !confirm(`Mark "${g.session}" (${fmtDay(g.date)}) as done without logging it?`)) return;
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
  const views = { today: viewToday, workout: viewWorkout, finish: viewFinish, progress: viewProgress, settings: viewSettings };
  $('#view').innerHTML = (views[S.view] || viewToday)();
  renderRest();
}

function renderStatus() {
  const online = navigator.onLine;
  const state = !S.settings.url ? 'offline' : S.syncing ? 'syncing' : S.lastError ? 'error' : S.pending ? 'pending' : online ? 'ok' : 'offline';
  const label = S.syncing ? 'Syncing…' : S.pending ? `${S.pending} to sync` : S.lastError ? 'Not synced' : S.lastSync ? `Synced ${ago(S.lastSync)}` : 'Not connected';
  $('#top').innerHTML = `<h1>Gym Log</h1><button class="sync ${state}" data-act="sync">${!online ? 'Offline · ' : ''}${label}</button>`;
}

function viewToday() {
  let h = '';
  if (!S.settings.url || !S.settings.token) {
    h += `<section class="card warn"><h2>Connect your sheet</h2><p>Paste the setup code from Apps Script in <b>Settings</b> so workouts sync to your tracker. You can still log offline in the meantime.</p><button class="btn" data-act="nav" data-v="settings">Open Settings</button></section>`;
  }
  if (S.lastSummary) {
    const s = S.lastSummary;
    h += `<section class="card good"><h2>Saved: ${esc(s.session)}</h2><p>${s.sets} working sets · ${s.vol.toLocaleString()} kg · ${s.mins} min</p>
      ${s.prs.length ? `<p>🏆 ${s.prs.map(esc).join('<br>🏆 ')}</p>` : ''}<p class="muted small">${S.pending ? 'Waiting for signal to sync – it is stored on the phone.' : 'Synced to your sheet.'}</p></section>`;
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

function hamstringCard(when) {
  const v = S.current.hamstring[when];
  return `<section class="card ham"><div class="row between"><h3>Hamstring ${when}</h3><span class="ham-val">${v ? `${v.pain}/10` : '–'}</span></div>
    <input type="range" min="0" max="10" step="0.5" value="${v ? v.pain : 0}" data-bind="ham:${when}">
    <div class="row"><button class="btn sm" data-act="ham-zero" data-w="${when}">0 – no pain</button>${v ? `<button class="btn sm ghost" data-act="ham-clear" data-w="${when}">Clear</button>` : ''}
    <span class="muted small">Goes to the Physio Diary</span></div></section>`;
}

function viewWorkout() {
  const w = S.current;
  let h = `<div class="wk-head"><div><h2>${esc(w.session)}</h2><span class="muted small" id="elapsed"></span></div><button class="btn primary" data-act="finish">Finish</button></div>`;
  if (S.settings.hamstring) h += hamstringCard('before');
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
  if (S.settings.hamstring) h += hamstringCard('after');
  h += `<button class="btn primary block" data-act="save">Save workout</button><button class="btn ghost block" data-act="nav" data-v="workout">Back to workout</button>`;
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
  return `<section class="card"><h2>Google Sheet connection</h2>
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
      ${tog('hamstring', 'Hamstring check-in', 'Before/after pain score, written to the Physio Diary.')}
      ${tog('keepAwake', 'Keep screen on', 'During a workout, so the rest timer stays visible.')}
      ${numIn('defaultRest', 'Default rest (s)')}${numIn('stepBarbell', 'Barbell increment (kg)')}${numIn('stepDumbbell', 'Dumbbell increment (kg)')}${numIn('stepOther', 'Machine/cable increment (kg)')}</section>
    <section class="card"><h2>Data</h2><p class="muted small">Everything is stored on this phone first and sent to the sheet when there is signal.</p>
      <button class="btn ghost" data-act="export">Export backup (JSON)</button>
      <p class="muted small" id="persist"></p><p class="muted small">Gym Log v${VERSION}</p></section>`;
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
  'ham-zero': d => { S.current.hamstring[d.w] = { pain: 0, time: hhmm() }; saveCurrent(); render(); },
  'ham-clear': d => { S.current.hamstring[d.w] = null; saveCurrent(); render(); },
  finish: () => { S.view = 'finish'; render(); window.scrollTo(0, 0); },
  save: () => finishWorkout(),
  discard: async () => { if (!confirm('Discard this workout? Nothing will be saved.')) return; S.current = null; await saveCurrent(true); stopRest(); releaseWakeLock(); S.view = 'today'; render(); },
  'rest-adj': d => { S.rest.end += +d.d * 1000; S.rest.total = Math.max(S.rest.total + +d.d, 1); S.rest.fired = false; kvSet('rest', S.rest); renderRest(); },
  'rest-stop': () => stopRest(),
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
  } else if (kind === 'ham') {
    S.current.hamstring[a] = { pain: num(e.target.value), time: hhmm() };
    const v = e.target.closest('.ham')?.querySelector('.ham-val');
    if (v) v.textContent = `${e.target.value}/10`;
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
  if (document.visibilityState === 'visible') { tickRest(); requestWakeLock(); if (S.view !== 'workout') syncAll(); }
});

setInterval(() => {
  tickRest();
  const el = $('#elapsed');
  if (el && S.current) el.textContent = `${mmss(Math.floor((Date.now() - new Date(S.current.startedAt)) / 1000))} elapsed`;
}, 500);
setInterval(() => { if (S.pending && S.view !== 'workout') syncAll(); }, 5 * 60000);

// ───────────────────────────── boot ─────────────────────────────

async function boot() {
  S.settings = { ...DEFAULT_SETTINGS, ...(await kvGet('settings') || {}) };
  S.data = await kvGet('data') || null;
  S.current = await kvGet('current') || null;
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
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) toast('App updated – close and reopen to use the new version', 6000);
    });
  }
}

boot();
