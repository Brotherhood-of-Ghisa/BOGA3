// Fixed display weights, never training targets or personal anatomical measurements.
// MRI combined-sex mean side volumes (mL), Riem et al. 2026, Table 3:
// https://doi.org/10.1152/japplphysiol.00772.2025 (102 healthy adults).
// Deltoid fractions: Garner & Pandy 2001, Table I, scaled to MRI deltoid:
// https://web.ecs.baylor.edu/faculty/garner/Research/GarnerPandy2001ArmModel.pdf
// Trapezius fractions: Yang et al. 2010, mass fractions assuming equal density:
// https://www.chjcana.com/EN/Y2010/V28/I1/7 (10 cadavers).
// The subdivisions are model estimates. Obliques represents external oblique
// only. Shares cover this non-overlapping mapped anatomy, not all body muscle.
export const MUSCLE_MAP_REFERENCE = [
  // pectoralis major × 1. Pectoralis major only; pectoralis minor is outside this mapping.
  {"id": "chest", "label": "Chest", "family": "Chest", "volume": 314.51},
  // serratus anterior × 1
  {"id": "serratus_anterior", "label": "Serratus", "family": "Chest", "volume": 173.59},
  // deltoid × 0.15573802. Deltoid split
  {"id": "delts_front", "label": "Front delts", "family": "Shoulders", "volume": 60.00897196261682},
  // deltoid × 0.47541211. Deltoid split
  {"id": "delts_lateral", "label": "Lateral delts", "family": "Shoulders", "volume": 183.18579439252335},
  // deltoid × 0.36884987. Deltoid split
  {"id": "delts_rear", "label": "Rear delts", "family": "Shoulders", "volume": 142.1252336448598},
  // supraspinatus × 1, subscapularis × 1, infraspinatus and teres minor × 1
  {"id": "rotator_cuff", "label": "Rotator cuff", "family": "Shoulders", "volume": 344.07000000000005},
  // latissimus dorsi × 1
  {"id": "back_lats", "label": "Lats", "family": "Back", "volume": 390.95},
  // rhomboid × 1, trapezius × 0.36863204. Trapezius split; rhomboids + middle trapezius.
  {"id": "back_upper", "label": "Upper back", "family": "Back", "volume": 148.7858877568064},
  // trapezius × 0.25647236. Trapezius split
  {"id": "traps_upper", "label": "Upper traps", "family": "Back", "volume": 55.14155670619676},
  // trapezius × 0.37489561. Trapezius split
  {"id": "traps_lower", "label": "Lower traps", "family": "Back", "volume": 80.60255553699682},
  // erector spinae × 1. Erector spinae only; multifidus is not silently added.
  {"id": "spinal_erectors", "label": "Spinal erectors", "family": "Back", "volume": 457.93},
  // biceps brachii × 1
  {"id": "biceps", "label": "Biceps", "family": "Arms", "volume": 154.04},
  // brachialis × 1
  {"id": "brachialis", "label": "Brachialis", "family": "Arms", "volume": 127.75},
  // triceps brachii × 1
  {"id": "triceps", "label": "Triceps", "family": "Arms", "volume": 391.43},
  // brachioradialis × 1, extensor carpi radialis × 1, digit extensors × 1, extensor carpi ulnaris × 1, deep forearm extensors × 1, supinator × 1, pronator teres × 1, flexor carpi radialis and palmaris longus × 1, flexor digitorum superficialis × 1, flexor carpi ulnaris × 1, flexor digitorum profundus × 1, flexor pollicis longus × 1, pronator quadratus × 1. Measured forearm groups; intrinsic hand muscles are not included.
  {"id": "forearms_grip", "label": "Forearms", "family": "Arms", "volume": 526.98},
  // rectus abdominis × 1
  {"id": "abs_rectus", "label": "Abs", "family": "Core", "volume": 242.19},
  // external oblique × 1. PROXY: external oblique only. Internal oblique is not measured in this table.
  {"id": "abs_obliques", "label": "Obliques", "family": "Core", "volume": 173.13},
  // rectus femoris × 1, vastus lateralis × 1, vastus intermedius × 1, vastus medialis × 1
  {"id": "quads", "label": "Quads", "family": "Legs", "volume": 1798.02},
  // semitendinosus × 1, semimembranosus × 1, biceps femoris: long head × 1, biceps femoris: short head × 1
  {"id": "hamstrings", "label": "Hamstrings", "family": "Legs", "volume": 682.24},
  // gluteus maximus × 1
  {"id": "glutes_max", "label": "Glute Max", "family": "Legs", "volume": 864.66},
  // gluteus medius × 1, gluteus minimus × 1. Glute med/min as in Boga; tensor fasciae latae is not included.
  {"id": "hip_abductors", "label": "Hip abductors", "family": "Legs", "volume": 416.82},
  // adductor brevis × 1, adductor magnus × 1, adductor longus × 1, gracilis × 1, pectineus × 1. Five adductor muscles; no overlap with the iliopsoas hip-flexor mapping.
  {"id": "adductors", "label": "Adductors", "family": "Legs", "volume": 959.88},
  // psoas major × 1, iliacus × 1. Iliopsoas only; rectus femoris remains in Quads. Sartorius is not included.
  {"id": "hip_flexors", "label": "Hip flexors", "family": "Legs", "volume": 402.44},
  // gastrocnemius: medial head × 1, gastrocnemius: lateral head × 1, soleus × 1
  {"id": "calves", "label": "Calves", "family": "Lower Legs", "volume": 790.27},
  // tibialis anterior × 1
  {"id": "tibialis_anterior", "label": "Tibialis", "family": "Lower Legs", "volume": 109.23},
] as const;

export type MuscleMapId = typeof MUSCLE_MAP_REFERENCE[number]['id'];
export type MuscleMapFamily = typeof MUSCLE_MAP_REFERENCE[number]['family'];
