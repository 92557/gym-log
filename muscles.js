import { FRONT, BACK, OUTLINE_FRONT, OUTLINE_BACK } from './bodymap-data.js';
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
  hamstringSlider: {
    m: { hamstrings: 3, glutes: 2, abs: 1, calves: 1 },
    feel: 'Hamstrings along the back of the thigh as you curl the heels in, and most of all as you slide them out slowly, with glutes holding the hips up.',
    not: 'Hips dropping or the lower back arching to keep them up, or a cramp behind the knee; stop and reset.',
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
  'hamstring sliders': P.hamstringSlider, 'hamstring slider': P.hamstringSlider, 'slider leg curl': P.hamstringSlider,
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
  [/thrust|glute bridge/i, P.hipThrust], [/nordic/i, P.nordic], [/slider|sliding|ball curl|towel/i, P.hamstringSlider],
  [/leg curl|hamstring curl/i, P.legCurl],
  [/calf/i, P.calfRaise], [/side bend/i, P.sideBend], [/hollow|dead bug|plank|crunch|leg raise/i, P.core],
];

export function muscleInfo(name) {
  const k = String(name || '').trim().toLowerCase();
  if (BY_NAME[k]) return BY_NAME[k];
  const hit = PATTERNS.find(([re]) => re.test(k));
  return hit ? hit[1] : null;
}

// ── body map ──
// Realistic front/back figure (react-native-body-highlighter, MIT – see bodymap-data.js).
// Our muscle groups are mapped onto its regions; a region takes the highest level of the groups it covers.

const REGIONS = {
  chest: ['chest'], biceps: ['biceps'], triceps: ['triceps'], forearm: ['forearms'], abs: ['abs'], obliques: ['obliques'],
  quadriceps: ['quads'], adductors: ['adductors'], trapezius: ['traps'], 'upper-back': ['midBack', 'lats'],
  'lower-back': ['lowerBack'], gluteal: ['glutes'], hamstring: ['hamstrings'], calves: ['calves'],
};
const DELTOIDS = { front: ['delts_front', 'delts_side'], back: ['delts_rear', 'delts_side'] };
const SKIN = new Set(['head', 'hands', 'feet', 'ankles', 'knees', 'neck', 'tibialis']);

function figure(side, levels) {
  const parts = side === 'front' ? FRONT : BACK;
  const level = slug => {
    const groups = slug === 'deltoids' ? DELTOIDS[side] : REGIONS[slug] || [];
    return Math.max(0, ...groups.map(g => levels[g] || 0));
  };
  let g = '';
  for (const [slug, paths] of Object.entries(parts)) {
    const lv = SKIN.has(slug) || slug === 'hair' ? 0 : level(slug);
    const cls = slug === 'hair' ? 'hair' : SKIN.has(slug) ? 'skin' : lv ? `mus l${lv}` : 'off';
    for (const d of paths) g += `<path d="${d}" class="${cls}"/>`;
  }
  const vb = side === 'front' ? '0 0 724 1448' : '724 0 724 1448';
  return `<svg viewBox="${vb}" class="fig" role="img" aria-label="${side === 'front' ? 'Front' : 'Back'}">${g}
    <path d="${side === 'front' ? OUTLINE_FRONT : OUTLINE_BACK}" class="outline" vector-effect="non-scaling-stroke"/></svg>`;
}

export function bodyMap(levels) {
  return `<div class="bodymap"><figure>${figure('front', levels)}<figcaption>Front</figcaption></figure>
    <figure>${figure('back', levels)}<figcaption>Back</figcaption></figure></div>`;
}

/** Muscle names grouped by level, strongest first, for the text under the diagram. */
export function muscleList(levels) {
  const by = l => Object.entries(levels).filter(([, v]) => v === l).map(([k]) => NAMES[k]);
  return { main: by(3), assist: by(2), stabilise: by(1) };
}
