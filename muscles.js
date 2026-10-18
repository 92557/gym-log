// "Where to feel it" cues and a front/back body map with the working muscles shaded by how hard they work.
// Levels: 3 = main mover (dark red), 2 = assisting (mid red), 1 = stabilising (light red).

const NAMES = {
  chest: 'Chest', delts_front: 'Front shoulders', delts_side: 'Side shoulders', delts_rear: 'Rear shoulders',
  biceps: 'Biceps', triceps: 'Triceps', forearms: 'Forearms / grip', abs: 'Abs', obliques: 'Obliques',
  hipFlexors: 'Hip flexors', quads: 'Quads', adductors: 'Inner thighs', traps: 'Upper back / traps',
  midBack: 'Mid back', lats: 'Lats', lowerBack: 'Lower back', glutes: 'Glutes', hamstrings: 'Hamstrings', calves: 'Calves',
};

// Shared profiles, then the tracker's exercises mapped onto them (with any differences).
const P = {
  verticalPull: {
    m: { lats: 3, midBack: 2, biceps: 2, forearms: 2, delts_rear: 1, abs: 1 },
    feel: 'Lats (the sides of your back under the armpits) pulling your elbows down towards your ribs. Biceps and grip help.',
    not: 'Neck or upper traps shrugging up, or swinging from the lower back.',
  },
  muscleUp: {
    m: { lats: 3, triceps: 3, chest: 2, biceps: 2, delts_front: 2, midBack: 2, forearms: 2, abs: 2 },
    feel: 'Lats driving the pull to your sternum, then chest and triceps pressing you over the bar.',
    not: 'A pinch at the front of the shoulder in the transition, or kipping from the lower back.',
  },
  pulldown: {
    m: { lats: 3, midBack: 2, biceps: 2, delts_rear: 1, forearms: 1 },
    feel: 'Lats squeezing at the bottom with your chest tall and elbows driving down to your ribs.',
    not: 'Biceps doing most of the work, or leaning back to move the weight.',
  },
  horizontalRow: {
    m: { midBack: 3, lats: 2, delts_rear: 2, biceps: 2, traps: 1, forearms: 1 },
    feel: 'Between and around your shoulder blades as you squeeze them back.',
    not: 'Shrugging into the neck, or your lower back rocking to move the weight.',
  },
  oneArmRow: {
    m: { lats: 3, midBack: 2, delts_rear: 2, biceps: 2, obliques: 1, forearms: 1 },
    feel: 'The lat on the working side as you drive your elbow back towards your hip.',
    not: 'Upper traps or the top of your shoulder, or twisting your torso open.',
  },
  bowArrow: {
    m: { obliques: 3, abs: 2, midBack: 2, lats: 2, delts_rear: 2, glutes: 1 },
    feel: 'Mid back pulling, with your deep core and obliques holding the pelvis dead still.',
    not: 'Lower back arching or the torso rotating with the pull.',
  },
  facePull: {
    m: { delts_rear: 3, midBack: 2, traps: 1, delts_side: 1 },
    feel: 'Rear shoulders and between the shoulder blades, especially holding the end-range rotation.',
    not: 'Upper traps shrugging, or leaning back to move the stack.',
  },
  benchPress: {
    m: { chest: 3, delts_front: 2, triceps: 2, abs: 1 },
    feel: 'Chest stretching at the bottom and driving the press, with shoulder blades set.',
    not: 'A pinch at the front of the shoulder, or your lower back arching off the bench.',
  },
  closeGrip: {
    m: { triceps: 3, chest: 2, delts_front: 2 },
    feel: 'Triceps locking the weight out, with chest helping off the bottom.',
    not: 'Elbows flaring and the front of the shoulder taking over.',
  },
  inclinePress: {
    m: { chest: 3, delts_front: 3, triceps: 2 },
    feel: 'Upper chest and the front of your shoulders.',
    not: 'Lower back arching to turn it into a flat press.',
  },
  pushUp: {
    m: { chest: 3, triceps: 2, delts_front: 2, abs: 2 },
    feel: 'Chest and triceps pushing, with abs holding one straight line.',
    not: 'Hips sagging and your lower back taking the strain.',
  },
  hollowPushUp: {
    m: { chest: 3, abs: 3, triceps: 2, delts_front: 2, glutes: 1 },
    feel: 'Chest pushing while abs and glutes keep the posterior tilt (sit-bones forward).',
    not: 'Lower back sagging; drop to the knees if the brace breaks.',
  },
  dip: {
    m: { chest: 3, triceps: 3, delts_front: 2, abs: 1 },
    feel: 'Lower chest and triceps, controlling the descent.',
    not: 'A pinch at the front of the shoulder at the bottom; stop short of that depth.',
  },
  overheadPress: {
    m: { delts_front: 3, delts_side: 2, triceps: 2, traps: 1, abs: 2, glutes: 1 },
    feel: 'Shoulders pressing up, with abs and glutes keeping the ribs down.',
    not: 'Lower back arching as the bar goes overhead.',
  },
  pushPress: {
    m: { delts_front: 3, triceps: 2, delts_side: 2, quads: 2, glutes: 1, abs: 2 },
    feel: 'A quick leg drive from the quads, then shoulders and triceps finishing the press.',
    not: 'Lower back leaning back to get under the bar.',
  },
  squat: {
    m: { quads: 3, glutes: 3, adductors: 2, abs: 2, lowerBack: 1 },
    feel: 'Quads and glutes driving you up, braced through the middle.',
    not: 'Knees caving in, or your lower back rounding at the bottom.',
  },
  zercher: {
    m: { quads: 3, glutes: 2, abs: 3, traps: 2, lowerBack: 2, biceps: 1 },
    feel: 'Quads and glutes, with a hard brace in your abs and upper back holding the bar in your elbows.',
    not: 'The lower back rounding forward under the load.',
  },
  goblet: {
    m: { quads: 3, glutes: 2, adductors: 2, abs: 2 },
    feel: 'Quads working with your torso upright and the weight close to your chest.',
    not: 'Heels lifting or the lower back rounding.',
  },
  singleLeg: {
    m: { quads: 3, glutes: 3, adductors: 2, hamstrings: 1, obliques: 1 },
    feel: 'Front-leg quad and glute driving you up, hips square.',
    not: 'Pushing off the back leg, or the front knee caving in.',
  },
  deadlift: {
    m: { glutes: 3, hamstrings: 3, lowerBack: 2, traps: 2, lats: 2, quads: 2, forearms: 2 },
    feel: 'Glutes and hamstrings driving your hips forward, with lats keeping the bar close.',
    not: 'Lower back rounding or doing the lifting.',
  },
  trapBar: {
    m: { glutes: 3, quads: 3, hamstrings: 2, traps: 2, forearms: 2, lowerBack: 1 },
    feel: 'Legs and glutes pushing the floor away; sit-bones forward before you break the floor.',
    not: 'Lower back working or arching; it should stay quiet.',
  },
  rdl: {
    m: { hamstrings: 3, glutes: 3, lowerBack: 1, forearms: 1 },
    feel: 'A stretch in the hamstrings as your hips go back, then glutes bringing you up.',
    not: 'Lower back rounding or doing the lifting, or a sharp pull at the sit-bone.',
  },
  singleLegRdl: {
    m: { hamstrings: 3, glutes: 3, obliques: 1, lowerBack: 1, forearms: 1 },
    feel: 'Standing-leg hamstring stretching and glute bringing you up, hips square to the floor.',
    not: 'Hips opening up to the side, or lower back rounding.',
  },
  hipThrust: {
    m: { glutes: 3, hamstrings: 1, quads: 1, abs: 1 },
    feel: 'A hard glute squeeze at the top, ribs down.',
    not: 'Lower back arching to finish, or hamstrings cramping.',
  },
  nordic: {
    m: { hamstrings: 3, glutes: 1, calves: 1, abs: 1 },
    feel: 'Both hamstrings braking evenly as you lower, hips extended.',
    not: 'The knee or quad tendon, or a sharp pain at the sit-bone; stop the set if so.',
  },
  legCurl: {
    m: { hamstrings: 3, calves: 1 },
    feel: 'Hamstrings along the back of the thigh, slow on the way down.',
    not: 'Hips lifting off the pad, or a cramp behind the knee.',
  },
  hamstringSwitch: {
    m: { hamstrings: 3, glutes: 2, hipFlexors: 1, abs: 1 },
    feel: 'Quick, light hamstring contractions with the pelvis tilted.',
    not: 'The lower back joining in, or anything in the knee.',
  },
  calfRaise: {
    m: { calves: 3 },
    feel: 'Calves through a full stretch at the bottom and a pause at the top.',
    not: 'Bouncing out of the bottom.',
  },
  sideBend: {
    m: { obliques: 3, lowerBack: 1, abs: 1 },
    feel: 'The side of your waist opposite the weight, in a pure side bend.',
    not: 'Twisting or leaning forward.',
  },
  core: {
    m: { abs: 3, obliques: 2, hipFlexors: 1 },
    feel: 'Low abs, with your lower back pressed to the floor.',
    not: 'Lower back lifting or arching.',
  },
};

const BY_NAME = {
  'assisted pull-up': P.verticalPull, 'pull-up': P.verticalPull, 'weighted pull-up': P.verticalPull,
  'explosive pull-up': P.verticalPull, 'chest-to-bar pull-up (banded)': P.verticalPull, 'dead-hang power pull': P.verticalPull,
  'muscle-up (band-assisted)': P.muscleUp, 'muscle-up (unassisted attempt)': P.muscleUp, 'muscle-up negative': P.muscleUp,
  'lat pulldown': P.pulldown,
  'inverted row': { ...P.horizontalRow, m: { ...P.horizontalRow.m, abs: 1, glutes: 1 } },
  'seated cable row': P.horizontalRow, 'chest-supported row': P.horizontalRow,
  'single-arm db row': P.oneArmRow, 'bow-and-arrow row': P.bowArrow, 'face pull': P.facePull,
  'bench press': P.benchPress, 'db bench press': P.benchPress, 'neutral-grip db press': P.benchPress,
  'close-grip bench press': P.closeGrip, 'incline db press': P.inclinePress,
  'push-up': P.pushUp, 'hollow-body push-up': P.hollowPushUp,
  'dip': P.dip, 'weighted dip': P.dip, 'straight bar dip': P.dip,
  'overhead press': P.overheadPress, 'db shoulder press': P.overheadPress, 'push press': P.pushPress,
  'back squat': P.squat, 'zercher squat': P.zercher, 'goblet squat': P.goblet,
  'bulgarian split squat': P.singleLeg, 'walking lunge': P.singleLeg, 'step-up': P.singleLeg,
  'deadlift': P.deadlift, 'trap-bar deadlift': P.trapBar,
  'romanian deadlift': P.rdl, 'kickstand rdl': P.rdl, 'staggered db rdl': P.rdl, 'single-leg rdl': P.singleLegRdl,
  'hip thrust': P.hipThrust, 'glute bridge (barbell)': P.hipThrust, 'single-leg hip thrust': P.hipThrust,
  'nordic hamstring curl': P.nordic, 'hamstring curl (machine)': P.legCurl, 'prone leg curl': P.legCurl,
  'hamstring switches': P.hamstringSwitch,
  'calf raise (machine)': P.calfRaise, 'standing calf raise': P.calfRaise, 'side bend': P.sideBend,
};

// Names not in the tracker yet (e.g. a new lift in the Planned tab) are matched by type.
const PATTERNS = [
  [/face pull|rear delt/i, P.facePull], [/muscle-?up/i, P.muscleUp], [/pull-?up|chin-?up|power pull/i, P.verticalPull],
  [/pulldown/i, P.pulldown], [/single-arm.*row|one-arm.*row/i, P.oneArmRow], [/row/i, P.horizontalRow],
  [/close-grip/i, P.closeGrip], [/incline/i, P.inclinePress], [/bench|chest press|floor press/i, P.benchPress],
  [/push-?up/i, P.pushUp], [/dip/i, P.dip], [/push press/i, P.pushPress],
  [/overhead|shoulder press|military|arnold/i, P.overheadPress],
  [/zercher/i, P.zercher], [/goblet/i, P.goblet], [/split squat|lunge|step-?up/i, P.singleLeg], [/squat|leg press/i, P.squat],
  [/trap-?bar/i, P.trapBar], [/single-leg rdl/i, P.singleLegRdl], [/rdl|romanian|good morning/i, P.rdl], [/deadlift/i, P.deadlift],
  [/thrust|glute bridge/i, P.hipThrust], [/nordic/i, P.nordic], [/leg curl|hamstring curl/i, P.legCurl],
  [/calf/i, P.calfRaise], [/side bend/i, P.sideBend], [/hollow|dead bug|plank|crunch|leg raise/i, P.core],
];

export function muscleInfo(name) {
  const k = String(name || '').trim().toLowerCase();
  if (BY_NAME[k]) return BY_NAME[k];
  const hit = PATTERNS.find(([re]) => re.test(k));
  return hit ? hit[1] : null;
}

// ── body map ──
// One figure is drawn in a 100 × 200 box; left-side shapes are mirrored to the right.
const SIL = `
  <circle cx="50" cy="14" r="9"/><rect x="46" y="21" width="8" height="7"/>
  <path d="M29 30 Q50 25 71 30 L73 41 Q68 62 66 86 Q66 96 64 99 L36 99 Q34 96 34 86 Q32 62 27 41 Z"/>
  <rect x="20" y="32" width="9" height="34" rx="4.5"/><rect x="71" y="32" width="9" height="34" rx="4.5"/>
  <rect x="17" y="63" width="8" height="31" rx="4"/><rect x="75" y="63" width="8" height="31" rx="4"/>
  <circle cx="20.5" cy="98" r="4"/><circle cx="79.5" cy="98" r="4"/>
  <rect x="35" y="94" width="14" height="50" rx="6"/><rect x="51" y="94" width="14" height="50" rx="6"/>
  <rect x="37" y="142" width="10" height="44" rx="5"/><rect x="53" y="142" width="10" height="44" rx="5"/>
  <ellipse cx="42" cy="189" rx="6" ry="3"/><ellipse cx="58" cy="189" rx="6" ry="3"/>`;

// [muscle, shape, mirrored?]  shape: ['e', cx, cy, rx, ry] or ['r', x, y, w, h, r]
const FRONT = [
  ['delts_side', ['e', 25.5, 37, 3, 5], true], ['delts_front', ['e', 30.5, 36.5, 5, 5.5], true],
  ['chest', ['e', 41, 44, 8.5, 6], true], ['biceps', ['e', 24.5, 50, 3.6, 10], true],
  ['forearms', ['e', 21, 76, 3.4, 10], true], ['abs', ['r', 44.5, 52, 11, 30, 3], false],
  ['obliques', ['e', 36.5, 68, 3.5, 11], true], ['hipFlexors', ['e', 42, 92, 4, 3.5], true],
  ['quads', ['e', 41, 116, 6.5, 19], true], ['adductors', ['e', 47.2, 108, 2.4, 10], true],
];
const BACK = [
  ['traps', ['e', 50, 34, 13, 5], false], ['delts_side', ['e', 25.5, 37, 3, 5], true],
  ['delts_rear', ['e', 30.5, 37, 5, 5.5], true], ['midBack', ['e', 50, 47, 8, 7], false],
  ['lats', ['e', 37, 56, 6, 12], true], ['triceps', ['e', 24.5, 50, 3.6, 10], true],
  ['forearms', ['e', 21, 76, 3.4, 10], true], ['lowerBack', ['r', 45, 64, 10, 22, 3], false],
  ['obliques', ['e', 35, 74, 2.5, 8], true], ['glutes', ['e', 43, 100, 7.5, 8], true],
  ['hamstrings', ['e', 42, 124, 6, 17], true], ['adductors', ['e', 48.6, 112, 1.6, 8], true],
  ['calves', ['e', 42, 158, 5, 12], true],
];

const shape = (s, mirror) => {
  if (s[0] === 'e') { const cx = mirror ? 100 - s[1] : s[1]; return `<ellipse cx="${cx}" cy="${s[2]}" rx="${s[3]}" ry="${s[4]}"`; }
  const x = mirror ? 100 - s[1] - s[3] : s[1];
  return `<rect x="${x}" y="${s[2]}" width="${s[3]}" height="${s[4]}" rx="${s[5]}"`;
};

function figure(parts, levels, dx, label) {
  let g = `<g transform="translate(${dx} 0)"><g class="sil">${SIL}</g>`;
  for (const [muscle, s, mirrored] of parts) {
    const lv = levels[muscle];
    if (!lv) continue;
    const t = `<title>${NAMES[muscle]}</title>`;
    g += `${shape(s, false)} class="mus l${lv}">${t}</${s[0] === 'e' ? 'ellipse' : 'rect'}>`;
    if (mirrored) g += `${shape(s, true)} class="mus l${lv}">${t}</${s[0] === 'e' ? 'ellipse' : 'rect'}>`;
  }
  return g + `<text x="50" y="199" class="cap">${label}</text></g>`;
}

export function bodyMap(levels) {
  return `<svg class="bodymap" viewBox="0 0 210 202" role="img" aria-label="Muscles worked">
    ${figure(FRONT, levels, 0, 'Front')}${figure(BACK, levels, 110, 'Back')}</svg>`;
}

/** Muscle names grouped by level, strongest first, for the text under the diagram. */
export function muscleList(levels) {
  const by = l => Object.entries(levels).filter(([, v]) => v === l).map(([k]) => NAMES[k]);
  return { main: by(3), assist: by(2), stabilise: by(1) };
}
