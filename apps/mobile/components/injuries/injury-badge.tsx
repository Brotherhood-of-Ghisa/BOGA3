import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import { uiBorder, uiGeometry, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { InjuryStatus } from '@/src/data/injuries';
import type { InjuryWarningSeverity } from '@/src/injuries/injury-warning-engine';

export type InjuryBadgeProps = {
  status?: InjuryStatus;
  severity?: InjuryWarningSeverity;
  label?: string;
  testID?: string;
  onPress?: () => void;
};

export function InjuryBadge({
  status,
  severity,
  label,
  testID = 'injury-badge',
  onPress,
}: InjuryBadgeProps) {
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();

  const effectiveStatus = severity ?? status ?? 'managing';
  const defaultLabel =
    effectiveStatus === 'acute'
      ? 'Acute'
      : effectiveStatus === 'managing'
      ? 'Managing'
      : effectiveStatus === 'monitoring'
      ? 'Monitoring'
      : 'Resolved';

  const badgeText = label ?? defaultLabel;

  const content = (
    <View
      accessibilityRole="text"
      accessibilityLabel={`Injury status: ${badgeText}`}
      style={[
        styles.badge,
        effectiveStatus === 'acute'
          ? styles.badgeAcute
          : effectiveStatus === 'monitoring'
          ? styles.badgeMonitoring
          : styles.badgeManaging,
      ]}
      testID={testID}>
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={[
          text.label,
          styles.labelText,
          effectiveStatus === 'acute' ? styles.labelAcute : null,
        ]}>
        {badgeText}
      </Text>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View injury: ${badgeText}`}
        onPress={onPress}
        style={({ pressed }) => [pressed ? styles.pressed : null]}>
        {content}
      </Pressable>
    );
  }

  return content;
}

const useStyles = makeStyles((roles) => ({
  badge: {
    alignSelf: 'center',
    paddingHorizontal: uiSpace.xs,
    paddingVertical: 0,
    borderWidth: uiBorder.width,
    borderRadius: uiGeometry.radius.pill,
    backgroundColor: roles.surface,
    borderColor: roles.rule,
  },
  badgeAcute: {
    borderColor: roles.danger,
    backgroundColor: roles.surface,
  },
  badgeManaging: {
    borderColor: roles.rule,
  },
  badgeMonitoring: {
    borderColor: roles.ruleSoft,
  },
  labelText: {
    color: roles.inkMuted,
    fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs,
  },
  labelAcute: {
    color: roles.danger,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.7,
  },
}));
