import type { ChangeTone } from '@/components/ui';
import { formatOneRepMax, formatWholeSetCount } from '@/src/exercise-calculations/format';

// How a change between two periods is said ([[comparison.change-display]]).
// The tone is its direction, drawn by `changeToneColour`; the text carries the
// sign of any change, so the direction reads without the colour. No change is
// a plain `0`, with no sign.
export type DeltaDisplay = { text: string; tone: ChangeTone };

const signed = (difference: number, magnitude: string): DeltaDisplay => ({
  text: `${difference > 0 ? '+' : '−'}${magnitude}`,
  tone: difference > 0 ? 'positive' : 'negative',
});

// A set change is the difference of the whole sets drawn, so it always adds up.
export const formatCountDelta = (current: number, previous: number): DeltaDisplay => {
  const difference = Math.round(current) - Math.round(previous);
  if (!Number.isFinite(difference)) return { text: '—', tone: 'neutral' };
  if (difference === 0) return { text: '0', tone: 'neutral' };
  return signed(difference, formatWholeSetCount(Math.abs(difference)));
};

export const formatVolumeDelta = (current: number | null, previous: number | null): DeltaDisplay => {
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous)) return { text: '—', tone: 'neutral' };
  if (current === 0 && previous === 0) return { text: '—', tone: 'neutral' };
  if (previous === 0) return { text: 'new', tone: 'new' };
  const percent = Math.round(((current - previous) / previous) * 100);
  if (!Number.isFinite(percent)) return { text: 'Increased', tone: 'positive' };
  if (percent === 0) return { text: '0%', tone: 'neutral' };
  return signed(percent, `${Math.abs(percent)}%`);
};

/**
 * A 1RM change is the signed difference in kg, in 1RM's own format
 * ([[comparison.change-display]]): a 1RM is a weight, so the difference reads
 * in the unit the lifter trains in. No estimate in the earlier period is
 * `new`; none in the current one is unavailable, not a loss.
 */
export const formatOneRepMaxDelta = (current: number | null, previous: number | null): DeltaDisplay => {
  const now = current !== null && Number.isFinite(current) ? current : null;
  const before = previous !== null && Number.isFinite(previous) ? previous : null;
  if (now === null) return { text: '—', tone: 'neutral' };
  if (before === null) return { text: 'new', tone: 'new' };
  const difference = now - before;
  // The sign follows the figure drawn, not the raw difference: 100.04 against
  // 100.00 shows `100.0` twice, so its change is level, not `+0.0`.
  const magnitude = formatOneRepMax(Math.abs(difference));
  if (Number(magnitude) === 0) return { text: '0', tone: 'neutral' };
  return signed(difference, magnitude);
};
