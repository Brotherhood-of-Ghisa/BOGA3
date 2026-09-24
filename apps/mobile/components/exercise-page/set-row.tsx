import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { Stat } from '@/components/ui/stat';
import { uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';
import {
  formatEffort,
  formatOneRepMax,
  formatVolume,
  formatWeight,
  type SetRowView,
} from '@/src/session-recorder/exercise-page-model';

import { pageText } from './text-styles';

type SetRowProps = {
  row: SetRowView;
  divider: boolean;
  onOpen: (setId: string) => void;
  onToggle: (setId: string) => void;
};

const DASH = '—';

const describeValues = (row: SetRowView) =>
  row.weight === null && row.reps === null
    ? 'no values'
    : `${row.weight !== null ? formatWeight(row.weight) : DASH} × ${row.reps ?? DASH}`;

/**
 * The set row (`ux-rules` §14a.1–§14a.4): `[type 44][weight × reps][1RM / VOL][control 44]`.
 * Performed rows are realised; rows not yet performed show their values faded.
 * The glyph carries the state (`design-language.md` §5). Every figure takes the
 * row's colour and weight; only a record weight or 1RM stands out, in `record`.
 * The row body opens the row in the logger; the glyph performs or un-performs it.
 */
export function SetRow({ row, divider, onOpen, onToggle }: SetRowProps) {
  const performed = row.kind === 'performed';
  const values = describeValues(row);
  const effort = formatEffort(row.setType);
  const glyph = performed ? 'set-done' : row.isCursor ? 'set-current' : 'set-planned';
  const statState = performed ? 'realised' : 'planned';

  return (
    <ListRow
      density="list"
      divider={divider}
      leading={
        <Text style={[pageText.microLabel, styles.type, performed ? styles.typePerformed : null]}>
          {effort}
        </Text>
      }
      meta={
        <View>
          <Stat
            emphasis={row.oneRepMaxRecord ? 'record' : 'none'}
            label="1RM"
            layout="inline"
            state={statState}
            testID={`exercise-set-${row.number}-1rm`}
            value={row.oneRepMax !== null ? formatOneRepMax(row.oneRepMax) : DASH}
          />
          <Stat
            label="Vol"
            layout="inline"
            rank="secondary"
            state={statState}
            testID={`exercise-set-${row.number}-vol`}
            value={row.volume !== null ? formatVolume(row.volume) : DASH}
          />
        </View>
      }
      testID={`exercise-set-${row.number}`}
      trailing={
        <Pressable
          accessibilityLabel={
            performed ? `Mark set ${row.number} not performed` : `Mark set ${row.number} performed`
          }
          accessibilityRole="checkbox"
          accessibilityState={{ checked: performed }}
          onPress={() => onToggle(row.id)}
          style={styles.glyph}
          testID={`exercise-set-${row.number}-toggle`}>
          <Icon name={glyph} />
        </Pressable>
      }>
      <Pressable
        accessibilityHint="Opens the set for editing"
        accessibilityLabel={`Set ${row.number}, ${effort}, ${values}, ${performed ? 'performed' : 'not performed'}`}
        accessibilityRole="button"
        onPress={() => onOpen(row.id)}
        style={styles.body}
        testID={`exercise-set-${row.number}-open`}>
        <Text
          numberOfLines={1}
          style={[
            pageText.runningFigure,
            performed ? (row.weightRecord ? styles.figureRecord : null) : styles.figurePlanned,
          ]}
          testID={`exercise-set-${row.number}-values`}>
          {row.weight === null && row.reps === null
            ? DASH
            : `${row.weight !== null ? formatWeight(row.weight) : DASH} × ${row.reps ?? DASH}`}
        </Text>
      </Pressable>
    </ListRow>
  );
}

const styles = StyleSheet.create({
  type: {
    width: uiGeometry.tapTarget,
  },
  typePerformed: {
    color: uiRoles.ink,
  },
  body: {
    justifyContent: 'center',
    paddingVertical: uiSpace.sm,
  },
  figurePlanned: {
    color: uiRoles.inkFaint,
  },
  figureRecord: {
    fontWeight: '700',
    color: uiRoles.record,
  },
  glyph: {
    width: uiGeometry.tapTarget,
    height: uiGeometry.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
