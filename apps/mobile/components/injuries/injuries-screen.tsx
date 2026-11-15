import { useState } from 'react';
import { View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/page-header';
import { ScreenScroll } from '@/components/ui/screen';
import { StatePanel } from '@/components/ui/state-panel';
import { makeStyles } from '@/components/ui/theme-context';
import { uiSpace } from '@/components/ui/tokens';
import type { InjuryView } from '@/src/data/injuries';
import { INJURIES_LOAD_ERROR, useInjuries } from '@/src/injuries/use-injuries';
import { InjuryEditorSheet } from './injury-editor-sheet';
import { InjuryRow } from './injury-row';

export type InjuriesScreenProps = {
  muscleGroupId?: string;
  initialNew?: boolean;
};

export function InjuriesScreen({ muscleGroupId, initialNew = false }: InjuriesScreenProps) {
  const styles = useStyles();
  const { state, reload } = useInjuries({ muscleGroupId });

  const [editorVisible, setEditorVisible] = useState(initialNew);
  const [selectedInjury, setSelectedInjury] = useState<InjuryView | null>(null);

  const handleOpenNew = () => {
    setSelectedInjury(null);
    setEditorVisible(true);
  };

  const handleOpenEdit = (injury: InjuryView) => {
    setSelectedInjury(injury);
    setEditorVisible(true);
  };

  const handleDismissEditor = () => {
    setEditorVisible(false);
    setSelectedInjury(null);
  };

  return (
    <ScreenScroll
      contentInsetAdjustmentBehavior="automatic"
      testID="injuries-screen">
      <ActionButton
        accessibilityLabel="Log new injury or discomfort"
        label="+ Log injury"
        onPress={handleOpenNew}
        testID="injuries-log-button"
        variant="primary"
      />

      {state.status === 'error' ? (
        <Card>
          <StatePanel
            action={{
              label: 'Retry',
              accessibilityLabel: 'Retry loading injuries',
              onPress: () => void reload(),
            }}
            body={INJURIES_LOAD_ERROR}
            fill={false}
            kind="error"
            testID="injuries-error-panel"
          />
        </Card>
      ) : null}

      {state.status === 'loading' && state.active.length === 0 && state.resolved.length === 0 ? (
        <Card>
          <StatePanel
            body="Loading injuries..."
            fill={false}
            kind="loading"
            testID="injuries-loading-panel"
          />
        </Card>
      ) : null}

      {/* Active Injuries Section */}
      <SectionHeader title={`Active injuries (${state.active.length})`} />

      {state.status !== 'loading' && state.active.length === 0 ? (
        <Card>
          <StatePanel
            body="No active injuries. Stay healthy!"
            fill={false}
            kind="message"
            testID="injuries-empty-active"
            title="All clear"
          />
        </Card>
      ) : (
        <Card testID="injuries-active-card">
          {state.active.map((injury, idx) => (
            <InjuryRow
              divider={idx < state.active.length - 1}
              injury={injury}
              key={injury.id}
              onPress={handleOpenEdit}
              testID={`injuries-active-row-${injury.id}`}
            />
          ))}
        </Card>
      )}

      {/* Resolved History Section */}
      {state.resolved.length > 0 ? (
        <>
          <View style={styles.resolvedSectionHeader}>
            <SectionHeader title={`Resolved history (${state.resolved.length})`} />
          </View>

          <Card testID="injuries-resolved-card">
            {state.resolved.map((injury, idx) => (
              <InjuryRow
                divider={idx < state.resolved.length - 1}
                injury={injury}
                key={injury.id}
                onPress={handleOpenEdit}
                testID={`injuries-resolved-row-${injury.id}`}
              />
            ))}
          </Card>
        </>
      ) : null}

      <InjuryEditorSheet
        initialMuscleGroupId={muscleGroupId}
        injury={selectedInjury}
        onDismiss={handleDismissEditor}
        onSaved={() => void reload()}
        testID="injuries-screen-editor"
        visible={editorVisible}
      />
    </ScreenScroll>
  );
}

const useStyles = makeStyles(() => ({
  resolvedSectionHeader: {
    marginTop: uiSpace.sm,
  },
}));
