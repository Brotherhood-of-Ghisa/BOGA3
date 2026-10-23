import Svg, { Circle, G, Line, Polygon } from 'react-native-svg';
import { changeToneColour } from '@/components/ui/change-tone';
import { uiRoles } from '@/components/ui';
import { formatVolume } from '@/src/exercise-calculations/format';
import { formatShortDate } from '@/src/utils/local-time';
import type { ExerciseDateFormat, ProgressMetric } from '@/src/preferences/model';
import type { MuscleTickerSeries } from '@/src/data/progress-muscle-tickers';
import { muscleTickerGeometry, TICKER_HEIGHT } from './muscle-ticker-geometry';

export type MuscleTickerStatus = 'pending' | 'loaded' | 'error';

export function muscleTickerDescription(series: MuscleTickerSeries | undefined, weeks: number, metric: ProgressMetric, dateFormat: ExerciseDateFormat, status: MuscleTickerStatus = 'loaded') {
  const name = metric === 'workingSetCount' ? 'Sets' : 'Volume';
  const latest = series?.observations.filter(row => row.value !== null).at(-1);
  const format = (value: number) => metric === 'totalVolume' ? formatVolume(value) : String(value);
  const empty = status === 'pending' ? 'History loading.' : status === 'error' ? 'History unavailable.'
    : series?.observations.length ? `No complete ${weeks}-week observations.` : 'No training observations.';
  return `${name}, rolling ${weeks} weeks. ${latest ? `Latest ${format(latest.value!)} on ${formatShortDate(latest.at, dateFormat)}.` : empty} ${series?.reference === null || series?.reference === undefined ? 'Reference unavailable.' : `${metric === 'workingSetCount' ? 'Target' : 'Historical median'} ${format(series.reference)}.`}`;
}

// The parent history link owns the spoken data and interaction; SVG is decorative.
export function MuscleTicker({ series, start, end, width, testID }: {
  series: MuscleTickerSeries; start: Date; end: Date; width: number; testID: string;
}) {
  const geometry = muscleTickerGeometry(series, start, end, width);
  if (!geometry) return null;
  const { segments, referenceY, firstX, lastX, endpoint } = geometry;
  return <Svg width={width} height={TICKER_HEIGHT} accessible={false} testID={testID}>
    {referenceY !== null && firstX !== lastX ? <Line x1={firstX} x2={lastX} y1={referenceY} y2={referenceY}
      stroke={uiRoles.inkGhost} strokeWidth={0.75} strokeDasharray="3 2" testID={`${testID}-reference`} /> : null}
    {segments.map((segment, index) => {
      const colour = changeToneColour(segment.tone);
      const { from, to } = segment;
      return <G key={index}>
        {referenceY !== null && segment.tone !== 'neutral' ? <Polygon
          points={`${from.x},${referenceY} ${from.x},${from.y} ${to.x},${to.y} ${to.x},${referenceY}`}
          fill={colour} fillOpacity={0.13} testID={`${testID}-fill-${index}`} /> : null}
        <Line x1={from.x} x2={to.x} y1={from.y} y2={to.y} stroke={colour} strokeWidth={1}
          strokeLinecap="round" testID={`${testID}-segment-${index}`} />
      </G>;
    })}
    <Circle cx={endpoint.x} cy={endpoint.y} r={2.5} fill={changeToneColour(endpoint.tone)} testID={`${testID}-endpoint`} />
  </Svg>;
}
