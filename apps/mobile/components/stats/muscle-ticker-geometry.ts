import type { MuscleTickerSeries } from '@/src/data/progress-muscle-tickers';

export type TickerPoint = { x: number; y: number };
export type TickerSegment = { from: TickerPoint; to: TickerPoint; tone: 'positive' | 'negative' | 'neutral' };
export const TICKER_HEIGHT = 32;
const PAD = 3;

export function muscleTickerGeometry(series: MuscleTickerSeries, start: Date, end: Date, width: number) {
  const known = series.observations.filter(row => row.value !== null);
  if (known.length === 0 || width < PAD * 2 || end <= start) return null;
  const values = known.map(row => row.value!);
  const reference = series.reference;
  const low = Math.min(...values, reference ?? Infinity);
  const high = Math.max(...values, reference ?? -Infinity);
  // Divide before subtracting to keep extreme finite volumes drawable.
  const scale = Math.max(Math.abs(low), Math.abs(high), 1);
  const minimum = low / scale;
  const span = (high / scale - minimum) || 1;
  const x = (at: Date) => PAD + Math.max(0, Math.min(1, (at.getTime() - start.getTime()) / (end.getTime() - start.getTime()))) * (width - 2 * PAD);
  const y = (value: number) => high === low ? TICKER_HEIGHT / 2
    : TICKER_HEIGHT - PAD - (value / scale - minimum) / span * (TICKER_HEIGHT - 2 * PAD);
  const referenceY = reference === null ? null : y(reference);
  const tone = (value: number): TickerSegment['tone'] => reference === null || value === reference ? 'neutral' : value > reference ? 'positive' : 'negative';
  const segments: TickerSegment[] = [];
  let previous: { point: TickerPoint; value: number } | null = null;
  for (const row of series.observations) {
    if (row.value === null) { previous = null; continue; }
    const point = { x: x(row.at), y: y(row.value) };
    if (previous) {
      const before = previous.value;
      if (reference !== null && (before < reference && row.value > reference || before > reference && row.value < reference)) {
        const ratio = Math.abs(before / scale - reference / scale) / Math.abs(row.value / scale - before / scale);
        const crossing = { x: previous.point.x + (point.x - previous.point.x) * ratio, y: referenceY! };
        segments.push({ from: previous.point, to: crossing, tone: tone(before) }, { from: crossing, to: point, tone: tone(row.value) });
      } else segments.push({ from: previous.point, to: point, tone: tone(before === reference ? row.value : before) });
    }
    previous = { point, value: row.value };
  }
  const latest = known[known.length - 1];
  return { segments, referenceY, firstX: x(known[0].at), lastX: x(latest.at),
    endpoint: { x: x(latest.at), y: y(latest.value!), tone: tone(latest.value!) } };
}
