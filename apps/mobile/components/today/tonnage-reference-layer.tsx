import { G, Line, Path, Rect, Text } from 'react-native-svg';

import { uiText } from '@/components/ui/text-roles';
import { uiRoles } from '@/components/ui/tokens';

import {
  REFERENCE_GAP, REFERENCE_HEIGHT, REFERENCE_ICON_WIDTH, REFERENCE_STROKE,
  type TonnageAnnotation,
} from './tonnage-references';

/** Passive annotation variant of PeriodPace; the chart speaks for all glyphs. */
export function TonnageReferenceLayer({ annotations, width }: { annotations: TonnageAnnotation[]; width: number }) {
  return (
    <G pointerEvents="none" testID="today-tonnage-references">
      {annotations.map(reference => (
        <Line key={reference.id} stroke={uiRoles.inkFaint} strokeWidth={REFERENCE_STROKE} strokeDasharray="12 7"
          x1={0} x2={width} y1={reference.y} y2={reference.y}
          testID={`today-tonnage-line-${reference.id}`} />
      ))}
      {annotations.map(reference => (
        <G key={reference.id}>
          {reference.y - reference.top > REFERENCE_HEIGHT + REFERENCE_GAP + REFERENCE_STROKE ? (
            <Line stroke={uiRoles.inkFaint} strokeWidth={REFERENCE_STROKE}
              x1={reference.x - REFERENCE_GAP} x2={reference.x - REFERENCE_GAP}
              y1={reference.top + REFERENCE_HEIGHT / 2} y2={reference.y}
              testID={`today-tonnage-leader-${reference.id}`} />
          ) : null}
          <Rect x={reference.x} y={reference.top} width={reference.width} height={REFERENCE_HEIGHT}
            fill={uiRoles.surface} testID={`today-tonnage-ground-${reference.id}`} />
          <G transform={`translate(${reference.x} ${reference.top})`}>
            <Path d={reference.path} fill="none" stroke={uiRoles.inkFaint} strokeWidth={1}
              strokeLinejoin="round" strokeLinecap="round" testID={`today-tonnage-icon-${reference.id}`} />
          </G>
          <Text x={reference.x + REFERENCE_ICON_WIDTH + REFERENCE_GAP} y={reference.top + REFERENCE_HEIGHT / 2}
            alignmentBaseline="central" fill={uiRoles.inkMuted}
            fontFamily={uiText.figureSmall.fontFamily} fontSize={uiText.figureSmall.fontSize} fontWeight={uiText.figureSmall.fontWeight}
            testID={`today-tonnage-label-${reference.id}`}>{reference.label}</Text>
        </G>
      ))}
    </G>
  );
}
