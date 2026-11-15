import { ANATOMY_ALIASES, resolveAnatomyAlias } from '@/src/injuries/anatomy-aliases';
import { SYSTEM_MUSCLE_GROUP_SEEDS } from '@/src/data/exercise-catalog-seeds';

describe('injuries anatomy aliases', () => {
  it('maps every alias to a valid system muscle group id', () => {
    const validMuscleGroupIds = new Set(SYSTEM_MUSCLE_GROUP_SEEDS.map((m) => m.id));
    expect(validMuscleGroupIds.size).toBeGreaterThan(0);

    for (const [alias, muscleGroupId] of Object.entries(ANATOMY_ALIASES)) {
      expect(validMuscleGroupIds.has(muscleGroupId)).toBe(true);
      expect(alias).toBe(alias.toLowerCase());
    }
  });

  describe('resolveAnatomyAlias', () => {
    it('resolves exact match lay terms', () => {
      expect(resolveAnatomyAlias('knee')).toBe('quads');
      expect(resolveAnatomyAlias('patella')).toBe('quads');
      expect(resolveAnatomyAlias('lumbar')).toBe('spinal_erectors');
      expect(resolveAnatomyAlias('lower back')).toBe('spinal_erectors');
      expect(resolveAnatomyAlias('elbow')).toBe('forearms_grip');
      expect(resolveAnatomyAlias('wrist')).toBe('forearms_grip');
      expect(resolveAnatomyAlias('rotator cuff')).toBe('rotator_cuff');
      expect(resolveAnatomyAlias('groin')).toBe('adductors');
      expect(resolveAnatomyAlias('hamstring')).toBe('hamstrings');
      expect(resolveAnatomyAlias('achilles')).toBe('calves');
      expect(resolveAnatomyAlias('abs')).toBe('abs_rectus');
      expect(resolveAnatomyAlias('shin splints')).toBe('tibialis_anterior');
    });

    it('normalizes casing and trims punctuation and excess whitespace', () => {
      expect(resolveAnatomyAlias('  KNEE!  ')).toBe('quads');
      expect(resolveAnatomyAlias('Lower   Back')).toBe('spinal_erectors');
      expect(resolveAnatomyAlias('Rotator Cuff...')).toBe('rotator_cuff');
      expect(resolveAnatomyAlias('ACHILLES')).toBe('calves');
    });

    it('resolves natural language sentences containing anatomical keywords', () => {
      expect(resolveAnatomyAlias('Severe pain in left knee during deep squats')).toBe('quads');
      expect(resolveAnatomyAlias('Acute lumbar tweak on deadlifts')).toBe('spinal_erectors');
      expect(resolveAnatomyAlias('Tight rotator cuff after benching')).toBe('rotator_cuff');
      expect(resolveAnatomyAlias('Right achilles tendon soreness')).toBe('calves');
    });

    it('returns null for unrecognized or empty input', () => {
      expect(resolveAnatomyAlias('')).toBeNull();
      expect(resolveAnatomyAlias('   ')).toBeNull();
      expect(resolveAnatomyAlias('completely unmapped ache')).toBeNull();
      expect(resolveAnatomyAlias('fuzzy headache')).toBeNull();
    });

    it('prefers specific compound phrases over shorter words within them', () => {
      expect(resolveAnatomyAlias('right inner thigh pain')).toBe('adductors');
      expect(resolveAnatomyAlias('sore lower trap')).toBe('traps_lower');
      expect(resolveAnatomyAlias('inner thigh')).toBe('adductors');
      expect(resolveAnatomyAlias('thigh strain')).toBe('quads');
      expect(resolveAnatomyAlias('upper trap tightness')).toBe('traps_upper');
      expect(resolveAnatomyAlias('trap ache')).toBe('traps_upper');
    });

    it('returns null for inherited Object prototype properties', () => {
      expect(resolveAnatomyAlias('constructor')).toBeNull();
      expect(resolveAnatomyAlias('__proto__')).toBeNull();
      expect(resolveAnatomyAlias('toString')).toBeNull();
      expect(resolveAnatomyAlias('valueOf')).toBeNull();
    });
  });
});
