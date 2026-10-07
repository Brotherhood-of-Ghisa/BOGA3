export type DeltaDisplay = { text: string; tone: 'positive' | 'negative' | 'neutral' | 'new' };

export const formatCountDelta = (current: number, previous: number): DeltaDisplay => {
  const difference = current - previous;
  return { text: difference === 0 ? '±0' : `${difference > 0 ? '+' : '−'}${Math.abs(difference)}`,
    tone: difference > 0 ? 'positive' : difference < 0 ? 'negative' : 'neutral' };
};

export const formatVolumeDelta = (current: number | null, previous: number | null): DeltaDisplay => {
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous)) return { text: '—', tone: 'neutral' };
  if (current === 0 && previous === 0) return { text: '—', tone: 'neutral' };
  if (previous === 0) return { text: 'new', tone: 'new' };
  const percent = Math.round(((current - previous) / previous) * 100);
  if (!Number.isFinite(percent)) return { text: 'Increased', tone: 'positive' };
  return { text: percent === 0 ? '±0%' : `${percent > 0 ? '+' : '−'}${Math.abs(percent)}%`,
    tone: percent > 0 ? 'positive' : percent < 0 ? 'negative' : 'neutral' };
};
