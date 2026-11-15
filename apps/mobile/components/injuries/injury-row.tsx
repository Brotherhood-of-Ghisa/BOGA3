import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Tag } from '@/components/ui/tag';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import { uiBorder, uiSpace } from '@/components/ui/tokens';
import type { InjuryView } from '@/src/data/injuries';
import {
  describePainScore,
  formatInjuryAnatomy,
  STATUS_PRESENTATIONS,
} from '@/src/injuries/injury-presentation';

export type InjuryRowProps = {
  injury: InjuryView;
  onPress: (injury: InjuryView) => void;
  divider?: boolean;
  testID?: string;
};

export function InjuryRow({ injury, onPress, divider = false, testID }: InjuryRowProps) {
  const styles = useStyles();
  const textRoles = useUiText();
  const textTones = useUiTextTone();

  const statusInfo = STATUS_PRESENTATIONS[injury.status];
  const painInfo = describePainScore(injury.painScore);
  const anatomy = formatInjuryAnatomy(injury.muscleGroupName, injury.side);

  const accessibilityLabel = [
    injury.label,
    statusInfo.label,
    anatomy,
    painInfo.spoken,
    injury.status === 'resolved' ? 'Resolved' : 'Active',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={() => onPress(injury)}
      style={({ pressed }) => [
        styles.row,
        divider ? styles.divider : null,
        pressed ? styles.pressed : null,
      ]}
      testID={testID ?? `injury-row-${injury.id}`}>
      <View style={styles.main}>
        <View style={styles.titleLine}>
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            style={[textRoles.bodyStrong, styles.title]}>
            {injury.label}
          </Text>
          <Tag
            label={statusInfo.shortLabel}
            testID={`injury-status-tag-${injury.id}`}
            tone={injury.status === 'resolved' ? 'faint' : 'neutral'}
          />
        </View>

        <View style={styles.metaLine}>
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            style={[textRoles.meta, textTones.muted]}>
            {anatomy}
          </Text>
          {injury.painScore !== null ? (
            <>
              <Text allowFontScaling={false} style={[textRoles.meta, textTones.muted]}>
                ·
              </Text>
              <Text
                allowFontScaling={false}
                style={[textRoles.meta, textTones[painInfo.colorRole]]}
                testID={`injury-pain-text-${injury.id}`}>
                {painInfo.scoreText} {painInfo.bandLabel}
              </Text>
            </>
          ) : null}
        </View>

        {injury.contraindications ? (
          <View style={styles.contraindicationsLine}>
            <Icon colorRole="danger" name="warning" size="xs" />
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              style={[textRoles.meta, textTones.danger]}>
              Avoid: {injury.contraindications}
            </Text>
          </View>
        ) : null}
      </View>

      <Icon colorRole="inkFaint" name="chevron-right" size="sm" />
    </Pressable>
  );
}

const useStyles = makeStyles((roles) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: uiSpace.md,
    paddingHorizontal: uiSpace.md,
    backgroundColor: roles.surface,
  },
  divider: {
    borderBottomWidth: uiBorder.width,
    borderBottomColor: roles.ruleSoft,
  },
  pressed: {
    backgroundColor: roles.paper,
  },
  main: {
    flex: 1,
    gap: uiSpace.xs,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  title: {
    flex: 1,
  },
  metaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  contraindicationsLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
    marginTop: uiSpace.xs,
  },
}));
