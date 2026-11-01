// Pattern Library 2.0 — mẫu lane có descriptor, chấm điểm chọn pattern, chuyển tiếp & motif.
export function rng(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const P = { stairUp: [0, 1, 2, 3], stairDown: [3, 2, 1, 0], roll: [0, 1, 2, 3, 2, 1], zigzag: [0, 2, 1, 3], wave: [1, 0, 2, 3], bounce: [0, 3, 1, 2], ladder: [0, 2, 1, 3, 0, 3], spiral: [0, 1, 3, 2], sweep: [0, 1, 2, 3, 1, 2], alt: [0, 2], alt2: [1, 3] };
// descriptor: diff 0..3 (min/max), minSpacing ms, jack 0..1, chord 0..1, complexity 0..1, energy ưa thích 0..1
export const PATTERN_LIBRARY = [
  d('single', 'basic', 0, 3, 150, 0, 0, .05, .3, ['balanced', 'beat', 'relax', 'melodic']),
  d('alternate', 'basic', 0, 3, 120, 0, 0, .1, .4, ['balanced', 'beat', 'relax']),
  d('stairUp', 'basic', 0, 3, 120, 0, 0, .2, .5, ['balanced', 'melodic', 'technical']),
  d('stairDown', 'basic', 0, 3, 120, 0, 0, .2, .5, ['balanced', 'melodic', 'technical']),
  d('roll', 'intermediate', 1, 3, 100, 0, 0, .35, .55, ['balanced', 'melodic']),
  d('zigzag', 'intermediate', 1, 3, 100, 0, 0, .4, .6, ['balanced', 'technical', 'melodic']),
  d('wave', 'intermediate', 1, 3, 100, 0, 0, .45, .6, ['melodic', 'balanced']),
  d('bounce', 'intermediate', 1, 3, 100, 0, 0, .5, .65, ['technical', 'melodic']),
  d('ladder', 'intermediate', 2, 3, 90, 0, 0, .6, .7, ['technical']),
  d('spiral', 'advanced', 2, 3, 85, 0, 0, .65, .8, ['technical', 'melodic']),
  d('sweep', 'advanced', 2, 3, 80, 0, 0, .7, .85, ['technical', 'balanced']),
  d('jackPair', 'intermediate', 1, 3, 110, .6, 0, .5, .6, ['technical', 'balanced']),
  d('jump', 'intermediate', 1, 3, 200, 0, 1, .45, .7, ['balanced', 'beat', 'technical']),
  d('burst', 'advanced', 2, 3, 80, 0, .15, .8, .95, ['technical', 'melodic']),
];
function d(id, category, minDifficulty, maxDifficulty, minSpacing, jackIntensity, chordRatio, rhythmicComplexity, energyPreference, compatibleModes) {
  return { id, name: id, category, minDifficulty, maxDifficulty, minSpacing, maxDensity: 1000 / minSpacing, laneTransitions: P[id] ? (P[id].length > 2 ? 'moving' : 'alternating') : 'varied', chordRatio, jackIntensity, rhythmicComplexity, energyPreference, compatibleModes, playabilityConstraints: { maxLaneJumpAtMinSpacing: category === 'basic' ? 2 : 3, maxChordSize: 2 } };
}
export const patternById = id => PATTERN_LIBRARY.find(p => p.id === id);

// Điểm chọn pattern: phù hợp năng lượng, độ khó, mode, đa dạng (phạt lặp theo độ gần), độ phức tạp mục tiêu + nhiễu có kiểm soát.
export function scorePattern(p, { energy, minGap, difficulty, mode, history, variety = 1, randomness = .15, rand, jackOk = true }) {
  if (difficulty < p.minDifficulty || difficulty > p.maxDifficulty || minGap < p.minSpacing || (p.jackIntensity > 0 && !jackOk)) return -Infinity;
  const target = difficulty / 3 * .7 + energy * .3;
  let s = (1 - Math.abs(energy - p.energyPreference)) * .9 - Math.abs(p.rhythmicComplexity - target) * .8 + (p.compatibleModes.includes(mode) ? .35 : 0);
  if (p.chordRatio > 0 && difficulty === 1) s -= .7; // Normal: chord là gia vị, không phải pattern chủ đạo
  const h = history.lastIndexOf(p.id); if (h >= 0) s -= (.9 / (history.length - h)) * variety;
  return s + rand() * randomness;
}
export function choosePattern(ctx) { let best = null, bs = -Infinity; for (const p of PATTERN_LIBRARY) { const s = scorePattern(p, ctx); if (s > bs) { bs = s; best = p; } } return best || patternById('single'); }

// Sinh dãy lane cho n note. Bắt đầu tại vị trí path gần prevLane nhất (≠ prevLane) → chuyển tiếp mượt, không nhảy lane vô lý.
export function patternLanes(p, n, prevLane, rand, { mirror = false, chordEvery = 1 } = {}) {
  const lanes = [];
  if (p.id === 'single') { let l = prevLane; for (let i = 0; i < n; i++) { const opts = [0, 1, 2, 3].filter(x => x !== l); l = opts[Math.floor(rand() * opts.length)]; lanes.push([l]); } return lanes; }
  if (p.id === 'jump') { const pairs = [[0, 3], [1, 2], [0, 2], [1, 3], [0, 1], [2, 3]]; for (let i = 0; i < n; i++) { const pr = pairs[(Math.floor(rand() * 6) + i) % 6].slice(); lanes.push(i % chordEvery === 0 ? pr : [pr[(i >> 1) % 2 ? 1 : 0]]); } return lanes; }
  if (p.id === 'jackPair') { let l = [0, 1, 2, 3].filter(x => x !== prevLane)[Math.floor(rand() * 3)]; for (let i = 0; i < n; i++) { if (i && i % 2 === 0) l = [0, 1, 2, 3].filter(x => x !== l)[Math.floor(rand() * 3)]; lanes.push([l]); } return lanes; }
  const path = (p.id === 'burst' ? P.roll : p.id === 'alternate' ? (rand() < .5 ? P.alt : P.alt2) : P[p.id]).map(x => mirror ? 3 - x : x);
  let o = 0, bd = 9; path.forEach((x, i) => { const dd = Math.abs(x - prevLane); if (x !== prevLane && dd < bd) { bd = dd; o = i; } });
  for (let i = 0; i < n; i++) lanes.push([path[(o + i) % path.length]]);
  return lanes;
}
