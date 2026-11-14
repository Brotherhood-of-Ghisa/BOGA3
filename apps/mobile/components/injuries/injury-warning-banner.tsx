import { Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { Icon } from '@/components/ui/icon';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import { uiBorder, uiGeometry, uiSpace } from '@/components/ui/tokens';
import type { InjuryWarning } from '@/src/injuries/injury-warning-engine';
import { describePainScore } from '@/src/injuries/injury-presentation';

export type InjuryWarningBannerProps = {
  warning: InjuryWarning;
  onSwap: () => void;
  onDismiss: () => void;
  testID?: string;
};

export function InjuryWarningBanner({
  warning,
  onSwap,
  onDismiss,
  testID = 'injury-warning-banner',
}: InjuryWarningBannerProps) {
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();

  const { injury, onsetText, contraindicationsText } = warning;
  const painLabel =
    injury.painScore !== null && injury.painScore !== undefined
      ? `Pain ${injury.painScore}/10 (${describePainScore(injury.painScore)})`
      : null;

  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel={`Injury warning: ${injury.label}. ${onsetText}.${painLabel ? ` ${painLabel}.` : ''}`}
      style={styles.banner}
      testID={testID}>
      <View style={styles.header}>
        <Icon colorRole="danger" name="warning" size="sm" />
        <View style={styles.headerText}>
          <Text allowFontScaling={false} numberOfLines={1} style={[text.title, styles.title]}>
            {injury.label}
          </Text>
          <Text allowFontScaling={false} style={[text.meta, tone.faint]}>
            {[onsetText, painLabel].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>

      {contraindicationsText ? (
        <View style={styles.contraindicationsBox}>
          <Text allowFontScaling={false} style={[text.label, styles.contraindicationsLabel]}>
            Caution
          </Text>
          <Text allowFontScaling={false} style={[text.body, styles.contraindicationsText]}>
            {contraindicationsText}
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <ActionButton
          label="Swap exercise"
          onPress={onSwap}
          size="compact"
          testID="injury-warning-swap"
          variant="outline"
        />
        <ActionButton
          label="Dismiss for this session"
          onPress={onDismiss}
          size="compact"
          testID="injury-warning-dismiss"
          variant="text"
        />
      </View>
    </View>
  );
}

const useStyles = makeStyles((roles) => ({
  banner: {
    backgroundColor: roles.surface,
    borderColor: roles.danger,
    borderWidth: uiBorder.width,
    borderRadius: uiGeometry.radius.card,
    padding: uiSpace.md,
    gap: uiSpace.sm,
    marginHorizontal: uiSpace.lg,
    marginBottom: uiSpace.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: uiSpace.sm,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: uiSpace.xs,
  },
  title: {
    color: roles.ink,
  },
  contraindicationsBox: {
    backgroundColor: roles.paper,
    padding: uiSpace.sm,
    borderRadius: uiGeometry.radius.control,
    gap: uiSpace.xs,
  },
  contraindicationsLabel: {
    color: roles.danger,
    fontWeight: '600',
  },
  contraindicationsText: {
    color: roles.inkMuted,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.md,
    flexWrap: 'wrap',
    paddingTop: uiSpace.xs,
  },
}));
