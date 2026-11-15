import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { PageSheet } from '@/components/ui/page-sheet';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import { uiBorder, uiGeometry, uiSpace } from '@/components/ui/tokens';
import { useExerciseCatalog } from '@/src/exercise-catalog/cache';
import { resolveExerciseSubstitutions } from '@/src/injuries/injury-substitutions';
import type { ExerciseMuscleMappingTarget } from '@/src/injuries/injury-warning-engine';

export type InjurySubstitutionSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  currentExercise: {
    id: string;
    name: string;
    mappings?: ExerciseMuscleMappingTarget[];
  };
  onSelect: (exercise: { id: string; name: string }) => void;
  onOpenFullCatalogue?: () => void;
  testID?: string;
};

export function InjurySubstitutionSheet({
  visible,
  onDismiss,
  currentExercise,
  onSelect,
  onOpenFullCatalogue,
  testID = 'injury-substitution-sheet',
}: InjurySubstitutionSheetProps) {
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  const catalog = useExerciseCatalog();

  const substitutions = useMemo(() => {
    if (!visible) return { curated: [], alternatives: [], all: [] };
    return resolveExerciseSubstitutions(currentExercise, catalog.exercises);
  }, [visible, currentExercise, catalog.exercises]);

  return (
    <PageSheet
      closeLabel="Close substitutions"
      onDismiss={onDismiss}
      testID={testID}
      title="Substitute exercise"
      visible={visible}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        style={styles.scroll}
        testID={`${testID}-scroll`}>
        {substitutions.curated.length > 0 ? (
          <View style={styles.section} testID="injury-substitution-curated-section">
            <Text allowFontScaling={false} style={[text.label, styles.sectionHeader]}>
              Recommended Joint-Friendly Alternatives
            </Text>
            <View style={styles.list}>
              {substitutions.curated.map((item) => (
                <ListRow
                  key={item.exercise.id}
                  description={item.curatedReason}
                  label={item.exercise.name}
                  leading={<Icon colorRole="accent" name="swap" />}
                  onPress={() => {
                    onSelect(item.exercise);
                  }}
                  testID={`substitute-curated-${item.exercise.id}`}
                  trailing={<Icon colorRole="inkFaint" name="chevron-right" size="sm" />}
                />
              ))}
            </View>
          </View>
        ) : null}

        {substitutions.alternatives.length > 0 ? (
          <View style={styles.section} testID="injury-substitution-alternatives-section">
            <Text allowFontScaling={false} style={[text.label, styles.sectionHeader]}>
              Same Muscle Group Alternatives
            </Text>
            <View style={styles.list}>
              {substitutions.alternatives.slice(0, 10).map((item) => (
                <ListRow
                  key={item.exercise.id}
                  label={item.exercise.name}
                  leading={<Icon colorRole="inkMuted" name="swap" />}
                  onPress={() => {
                    onSelect(item.exercise);
                  }}
                  testID={`substitute-alt-${item.exercise.id}`}
                  trailing={<Icon colorRole="inkFaint" name="chevron-right" size="sm" />}
                />
              ))}
            </View>
          </View>
        ) : null}

        {substitutions.all.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text allowFontScaling={false} style={[text.body, tone.faint]}>
              No specific substitutions found for this movement.
            </Text>
          </View>
        ) : null}

        {onOpenFullCatalogue ? (
          <View style={styles.footer}>
            <ActionButton
              label="Browse all exercises"
              onPress={onOpenFullCatalogue}
              testID="substitute-browse-all"
              variant="outline"
            />
          </View>
        ) : null}
      </ScrollView>
    </PageSheet>
  );
}

const useStyles = makeStyles((roles) => ({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: uiSpace.lg,
    paddingBottom: uiSpace.xl,
    gap: uiSpace.lg,
  },
  section: {
    gap: uiSpace.xs,
  },
  sectionHeader: {
    color: roles.inkMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: uiSpace.xs,
  },
  list: {
    borderRadius: uiGeometry.radius.card,
    overflow: 'hidden',
    borderWidth: uiBorder.width,
    borderColor: roles.rule,
    backgroundColor: roles.surface,
  },
  emptyBox: {
    padding: uiSpace.lg,
    alignItems: 'center',
  },
  footer: {
    paddingTop: uiSpace.sm,
    alignItems: 'center',
  },
}));
