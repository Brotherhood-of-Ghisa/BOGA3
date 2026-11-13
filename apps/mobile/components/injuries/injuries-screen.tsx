import { useState } from 'react';
import { Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { Card } from '@/components/ui/card';
import { ScreenScroll } from '@/components/ui/screen';
import { StatePanel } from '@/components/ui/state-panel';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
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
  const textRoles = useUiText();
  const textTones = useUiTextTone();
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
      <View style={styles.topActionContainer}>
        <ActionButton
          accessibilityLabel="Log new injury or discomfort"
          label="+ Log injury"
          onPress={handleOpenNew}
          testID="injuries-log-button"
          variant="primary"
        />
      </View>

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
      <View style={styles.sectionHeader}>
        <Text allowFontScaling={false} style={[textRoles.title, textTones.ink]}>
          Active injuries ({state.active.length})
        </Text>
      </View>

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
          <View style={[styles.sectionHeader, styles.resolvedSectionHeader]}>
            <Text allowFontScaling={false} style={[textRoles.title, textTones.muted]}>
              Resolved history ({state.resolved.length})
            </Text>
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
  topActionContainer: {
    paddingBottom: uiSpace.sm,
  },
  sectionHeader: {
    paddingVertical: uiSpace.sm,
    paddingHorizontal: uiSpace.xs,
  },
  resolvedSectionHeader: {
    marginTop: uiSpace.lg,
  },
}));
