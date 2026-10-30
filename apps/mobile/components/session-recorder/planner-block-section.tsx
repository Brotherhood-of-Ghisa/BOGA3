import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FilterChip } from '@/components/exercise-catalog/exercise-list-controls';
import { Card } from '@/components/ui/card';
import { ListRow } from '@/components/ui/list-row';
import { StatePanel } from '@/components/ui/state-panel';
import { FigureText } from '@/components/ui/figure-text';
import { uiText } from '@/components/ui/text-roles';
import { uiSpace } from '@/components/ui/tokens';
import { listAvailablePlanBlocks, type AvailablePlanBlockView } from '@/src/session-planner/available-blocks';

/**
 * The exercise picker's "From planner" source: authored one-off plan blocks
 * the active session can still consume. The chip in the filter row narrows
 * the list to these rows only (the Groups chip's pattern); a row pick asks
 * the host to attach the block. Source is stated in words — the plan title
 * and the block's position — not color.
 */
export function PickerPlannerToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <FilterChip
      accessibilityLabel="Show planned blocks only"
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      label="Planner"
      on={active}
      onPress={onToggle}
      testID="exercise-picker-planner-toggle"
    />
  );
}

type PlannerBlockSectionProps = {
  /** The host attaches the picked block; nothing is written here. */
  onPickBlock: (planExerciseId: string) => void;
};

export function PlannerBlockSection({ onPickBlock }: PlannerBlockSectionProps) {
  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'error' }
    | { phase: 'ready'; rows: AvailablePlanBlockView[] }
  >({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    listAvailablePlanBlocks()
      .then((rows) => {
        if (!cancelled) setState({ phase: 'ready', rows });
      })
      .catch(() => {
        if (!cancelled) setState({ phase: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.phase === 'loading') {
    return <StatePanel body="Loading planned blocks..." fill={false} kind="loading" testID="exercise-picker-planner-loading" />;
  }
  if (state.phase === 'error') {
    return (
      <StatePanel body="Couldn't load your planned blocks." fill={false} kind="error" testID="exercise-picker-planner-error" />
    );
  }
  if (state.rows.length === 0) {
    return <StatePanel body="No planned blocks to add." fill={false} testID="exercise-picker-planner-empty" />;
  }

  return (
    <View style={styles.section} testID="exercise-picker-planner-section">
      <Text allowFontScaling={false} accessibilityRole="header" style={uiText.label}>
        From planner
      </Text>
      <Card>
        {state.rows.map((row, index) => (
          <ListRow
            accessibilityLabel={`Planned block ${row.block.name} from ${row.planTitle}, block ${row.block.orderIndex + 1} of ${row.planBlockCount}`}
            density="list"
            divider={index > 0}
            key={row.block.id}
            onPress={() => onPickBlock(row.block.id)}
            testID={`exercise-picker-planner-block-${row.block.id}`}>
            <View style={styles.rowText}>
              <Text allowFontScaling={false} numberOfLines={2} style={uiText.bodyStrong}>
                <FigureText strong>{row.block.name}</FigureText>
              </Text>
              <Text allowFontScaling={false} numberOfLines={1} style={uiText.meta}>
                <FigureText>{`${row.planTitle} · Block ${row.block.orderIndex + 1} of ${row.planBlockCount}`}</FigureText>
              </Text>
            </View>
          </ListRow>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: uiSpace.sm,
  },
  rowText: {
    paddingVertical: uiSpace.sm,
  },
});
