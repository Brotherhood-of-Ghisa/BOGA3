/**
 * Static, zero-dependency anatomical alias dictionary.
 * Maps common lay terms, joints, tendons, and regions to canonical muscle_groups.id.
 */

export const ANATOMY_ALIASES: Readonly<Record<string, string>> = {
  // Knee & Patella -> quads
  knee: 'quads',
  patella: 'quads',
  'patellar tendon': 'quads',
  'quad tendon': 'quads',
  'runner knee': 'quads',
  'jumper knee': 'quads',
  quadriceps: 'quads',
  thigh: 'quads',

  // Lower Back & Spine -> spinal_erectors
  lumbar: 'spinal_erectors',
  'lower back': 'spinal_erectors',
  'low back': 'spinal_erectors',
  lumbago: 'spinal_erectors',
  sacrum: 'spinal_erectors',
  erectors: 'spinal_erectors',
  spine: 'spinal_erectors',

  // Elbow, Forearm, Wrist -> forearms_grip
  elbow: 'forearms_grip',
  wrist: 'forearms_grip',
  forearm: 'forearms_grip',
  grip: 'forearms_grip',
  'tennis elbow': 'forearms_grip',
  'golfer elbow': 'forearms_grip',
  epicondylitis: 'forearms_grip',
  carpal: 'forearms_grip',

  // Shoulder & Rotator Cuff -> rotator_cuff / deltoids
  'rotator cuff': 'rotator_cuff',
  impingement: 'rotator_cuff',
  supraspinatus: 'rotator_cuff',
  infraspinatus: 'rotator_cuff',
  subscapularis: 'rotator_cuff',
  'shoulder joint': 'rotator_cuff',
  'ac joint': 'rotator_cuff',
  acromioclavicular: 'rotator_cuff',
  labrum: 'rotator_cuff',

  // Deltoids
  shoulder: 'delts_front',
  'front delt': 'delts_front',
  'side delt': 'delts_lateral',
  'lateral delt': 'delts_lateral',
  'rear delt': 'delts_rear',

  // Chest / Pecs
  pec: 'chest',
  pecs: 'chest',
  pectoral: 'chest',
  peccy: 'chest',
  'sternum': 'chest',

  // Upper Back & Traps
  trap: 'traps_upper',
  traps: 'traps_upper',
  neck: 'traps_upper',
  'upper trap': 'traps_upper',
  'lower trap': 'traps_lower',
  rhomboid: 'back_upper',
  rhomboids: 'back_upper',
  'upper back': 'back_upper',
  'mid back': 'back_upper',
  scapula: 'back_upper',
  'shoulder blade': 'back_upper',

  // Lats
  lat: 'back_lats',
  lats: 'back_lats',
  latissimus: 'back_lats',

  // Arms
  bicep: 'biceps',
  biceps: 'biceps',
  'bicep tendon': 'biceps',
  tricep: 'triceps',
  triceps: 'triceps',
  'tricep tendon': 'triceps',

  // Hips & Pelvis
  groin: 'adductors',
  adductor: 'adductors',
  'inner thigh': 'adductors',
  'hip flexor': 'hip_flexors',
  psoas: 'hip_flexors',
  iliopsoas: 'hip_flexors',
  glute: 'glutes_max',
  glutes: 'glutes_max',
  buttock: 'glutes_max',
  piriformis: 'glutes_max',
  'outer hip': 'hip_abductors',
  'hip abductor': 'hip_abductors',
  abductor: 'hip_abductors',
  itb: 'hip_abductors',
  'it band': 'hip_abductors',

  // Posterior chain (Legs)
  hamstring: 'hamstrings',
  hamstrings: 'hamstrings',
  biceps_femoris: 'hamstrings',

  // Lower leg & Ankle
  calf: 'calves',
  calves: 'calves',
  gastrocnemius: 'calves',
  soleus: 'calves',
  achilles: 'calves',
  'achilles tendon': 'calves',
  ankle: 'calves',
  shin: 'tibialis_anterior',
  shins: 'tibialis_anterior',
  'shin splints': 'tibialis_anterior',
  tibialis: 'tibialis_anterior',

  // Core & Abs
  abdominal: 'abs_rectus',
  abdominals: 'abs_rectus',
  abs: 'abs_rectus',
  rectus: 'abs_rectus',
  oblique: 'abs_obliques',
  obliques: 'abs_obliques',
  flank: 'abs_obliques',
  rib: 'serratus_anterior',
  ribs: 'serratus_anterior',
  serratus: 'serratus_anterior',
};

// Pre-sort aliases by descending length so specific phrases (e.g. "inner thigh", "lower trap")
// take precedence over shorter general keywords (e.g. "thigh", "trap") in compound input.
const SORTED_ALIASES: readonly (readonly [string, string])[] = Object.entries(ANATOMY_ALIASES).sort(
  (a, b) => b[0].length - a[0].length,
);

/**
 * Resolves a natural-language term or query to a canonical muscle_group_id if recognized.
 * Case-insensitive, trims punctuation and extra whitespace.
 */
export function resolveAnatomyAlias(input: string): string | null {
  if (!input) return null;
  const normalized = input.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, ' ');

  // Exact lookup: guarded with Object.hasOwn so inherited Object prototype properties are excluded.
  if (Object.hasOwn(ANATOMY_ALIASES, normalized)) {
    return ANATOMY_ALIASES[normalized];
  }

  // Substring / word-level match for compound terms (e.g., "right knee strain" -> "knee", "right inner thigh" -> "inner thigh").
  for (const [alias, muscleGroupId] of SORTED_ALIASES) {
    const regex = new RegExp(`\\b${alias}\\b`, 'i');
    if (regex.test(normalized)) {
      return muscleGroupId;
    }
  }

  return null;
}
