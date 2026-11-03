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
  hamstringBridge: {
    m: { hamstrings: 3, glutes: 3, abs: 1, calves: 1 },
    feel: 'Hamstrings and glutes together holding the hips up, sit-bones tucked.',
    not: 'Lower back arching to keep the hips up, or a calf or hamstring cramp; lower and reset.',
  },
  sidePlank: {
    m: { obliques: 3, glutes: 3, abs: 2, delts_side: 1 },
    feel: 'The side of your waist underneath and the outer hip of the top leg lifting it.',
    not: 'Hips sagging or rolling forward, or the shoulder you are leaning on.',
  },
  copenhagen: {
    m: { adductors: 3, obliques: 3, abs: 2, glutes: 1 },
    feel: 'The inner thigh of the top leg holding you up, with the side of your waist underneath.',
    not: 'A sharp pain in the groin or at the knee on the bench; stop if so.',
  },
  pallof: {
    m: { abs: 3, obliques: 3, glutes: 1, delts_front: 1 },
    feel: 'Deep abs and the side of your trunk stopping the band from turning you.',
    not: 'Your torso or hips rotating, or the lower back arching.',
  },
  hipHike: {
    m: { glutes: 3, obliques: 2, abs: 1, quads: 1 },
    feel: 'The side of the standing hip lifting the free hip above level.',
    not: 'Leaning sideways or hitching from the lower back, or a locked knee.',
  },
  wallSit: {
    m: { quads: 3, glutes: 1, adductors: 1, abs: 1 },
    feel: 'The front of your thighs, back flat on the wall.',
    not: 'Knee pain above 3/10; slide higher up the wall.',
  },
  farmerCarry: {
    m: { forearms: 3, traps: 3, abs: 2, obliques: 2, glutes: 1, calves: 1 },
    feel: 'Grip and upper traps holding the weights, trunk braced as you walk tall.',
    not: 'Shoulders rounding forward, or leaning back.',
  },
  suitcaseCarry: {
    m: { obliques: 3, forearms: 3, abs: 2, traps: 2, glutes: 1 },
    feel: 'The side of your waist opposite the weight stopping you from leaning, plus grip.',
    not: 'Leaning towards the weight, or the shoulder on the loaded side dropping.',
  },
  medBall: {
    m: { chest: 3, triceps: 3, delts_front: 2, abs: 1 },
    feel: 'Chest and triceps firing fast, then absorbing the catch.',
    not: 'Shoulders shrugging, or the lower back arching to throw.',
  },
  ytRaise: {
    m: { delts_rear: 3, midBack: 3, traps: 2, delts_side: 1 },
    feel: 'Lower traps and rear shoulders, holding the top for a second.',
    not: 'Upper traps and neck shrugging, or swinging the weights up.',
  },
  externalRotation: {
    m: { delts_rear: 3, midBack: 1 },
    feel: 'Deep in the back of the shoulder as the forearm rotates out.',
    not: 'The elbow leaving your side, or the upper traps joining in.',
  },
  deadHang: {
    m: { forearms: 3, lats: 2, traps: 1, abs: 1 },
    feel: 'Grip working and lats stretching, shoulders gently active rather than sunk.',
    not: 'A pinch at the front of the shoulder.',
  },
  backExtension: {
    m: { lowerBack: 3, glutes: 2, hamstrings: 2 },
    feel: 'Back muscles holding a long, neutral spine, with glutes helping.',
    not: 'Over-arching at the top, or a pinch in the lower back.',
  },
  getUp: {
    m: { delts_front: 3, abs: 3, obliques: 3, delts_side: 2, glutes: 2, triceps: 1 },
    feel: 'The arm overhead locked and steady while your trunk and hips move under it.',
    not: 'The overhead shoulder wobbling or the elbow bending.',
  },
  // Movement screen tests: what each one checks rather than a muscle doing the work.
  screenAnkle: {
    m: { calves: 2 },
    feel: 'A stretch in the calf and Achilles as the knee goes over the toes, heel down.',
    not: 'A pinch at the front of the ankle.',
  },
  screenHip: {
    m: { glutes: 2, hipFlexors: 1 },
    feel: 'A stretch deep in the hip as the foot swings out, thigh still.',
    not: 'Pain in the groin or knee.',
  },
  screenHipFlexor: {
    m: { hipFlexors: 2, quads: 2 },
    feel: 'A stretch at the front of the hanging hip and thigh.',
    not: 'Lower back arching off the bench.',
  },
  screenHamstring: {
    m: { hamstrings: 2, hipFlexors: 2, abs: 1 },
    feel: 'A stretch along the back of the raised thigh, other leg flat.',
    not: 'A sharp pull at the sit-bone; never force it.',
  },
  screenTSpine: {
    m: { midBack: 2, obliques: 1 },
    feel: 'Your upper back turning, hips staying on your heels.',
    not: 'The lower back twisting to fake the range.',
  },
  screenShoulder: {
    m: { delts_rear: 2, midBack: 1 },
    feel: 'A stretch at the back of the shoulder, shoulder blade down.',
    not: 'Grinding or pain at the front of the shoulder.',
  },
  screenOverhead: {
    m: { lats: 2, abs: 2, delts_front: 1 },
    feel: 'Lats and shoulders lengthening while abs keep your ribs and low back down.',
    not: 'Ribs flaring or the lower back arching to reach the wall.',
  },
  screenSquat: {
    m: { quads: 2, glutes: 2, abs: 2, delts_front: 1, calves: 1 },
    feel: 'Legs, hips and ankles moving together with the stick staying over your feet.',
    not: 'Heels lifting, knees caving, or knee pain above 3/10.',
  },
  screenSingleLeg: {
    m: { quads: 3, glutes: 2, adductors: 1, calves: 1 },
    feel: 'Standing-leg quad and glute controlling the knee over the toes, pelvis level.',
    not: 'The knee diving inwards or the hip dropping.',
  },
  screenBalance: {
    m: { calves: 2, glutes: 2, abs: 1 },
    feel: 'Small adjustments in the foot, ankle and hip of the standing leg.',
    not: 'Grabbing for support; stop when the foot moves.',
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
  'hamstring bridge isometric': P.hamstringBridge, 'single-leg hamstring bridge': P.hamstringBridge,
  'side plank + hip abduction': P.sidePlank, 'copenhagen plank (short lever)': P.copenhagen,
  'pallof hold': P.pallof, 'hip hike': P.hipHike, 'wall sit': P.wallSit,
  'farmer carry': P.farmerCarry, 'suitcase carry': P.suitcaseCarry, 'med-ball chest pass': P.medBall,
  'prone y-t raise': P.ytRaise, 'cable external rotation': P.externalRotation,
  'dead hang': P.deadHang, 'back extensor hold': P.backExtension, 'turkish get-up': P.getUp,
  'knee-to-wall': P.screenAnkle, 'hip internal rotation (seated)': P.screenHip, 'thomas test': P.screenHipFlexor,
  'active straight-leg raise': P.screenHamstring, 't-spine rotation': P.screenTSpine,
  'shoulder internal rotation': P.screenShoulder, 'overhead wall test': P.screenOverhead,
  'overhead squat': P.screenSquat, 'step-down': P.screenSingleLeg, 'y-balance anterior reach': P.screenSingleLeg,
  'single-leg balance (eyes closed)': P.screenBalance,
};

// Names not in the tracker yet (e.g. a new lift in the Planned tab) are matched by type.
const PATTERNS = [
  [/copenhagen|adductor/i, P.copenhagen], [/side plank/i, P.sidePlank], [/pallof|anti-rotation/i, P.pallof],
  [/suitcase/i, P.suitcaseCarry], [/carry|farmer/i, P.farmerCarry], [/med-?ball|chest pass|ball slam/i, P.medBall],
  [/y-t|[yt] raise/i, P.ytRaise], [/external rotation/i, P.externalRotation], [/hamstring bridge/i, P.hamstringBridge],
  [/hip hike/i, P.hipHike], [/wall sit/i, P.wallSit], [/dead hang/i, P.deadHang], [/get-?up/i, P.getUp],
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
