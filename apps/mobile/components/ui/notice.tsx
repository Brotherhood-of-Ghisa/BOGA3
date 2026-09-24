import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

// `neutral`: information — offline, saved, unavailable. `danger`: something
// failed. There is no success or warning hue: the glyph and the words carry the
// state (`design-language.md` §5).
export type NoticeTone = 'neutral' | 'danger';

export type NoticeProps = {
  message: string;
  tone?: NoticeTone;
  // `offline`, `success`, `warning`… Omit for words alone.
  icon?: IconName;
  // Announce the notice when it appears (an outcome, a status change).
  live?: boolean;
  // A control that belongs to the notice, e.g. `Retry`.
  action?: ReactNode;
  testID?: string;
};

// A band that states something about the screen: `surface-subtle` on a `rule`
// hairline at the card radius, an optional leading glyph and the words.
export function Notice({ message, tone = 'neutral', icon, live = false, action, testID }: NoticeProps) {
  const danger = tone === 'danger';
  return (
    <View
      accessibilityLiveRegion={live ? 'polite' : undefined}
      accessibilityRole={danger ? 'alert' : undefined}
      style={[styles.band, danger ? styles.bandDanger : null]}
      testID={testID}>
      {icon ? <Icon color={danger ? uiRoles.danger : uiRoles.inkMuted} name={icon} size="sm" /> : null}
      <Text style={[styles.message, danger ? styles.messageDanger : null]}>{message}</Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    backgroundColor: uiRoles.surfaceSubtle,
    borderWidth: uiBorder.width,
    borderColor: uiRoles.rule,
    borderRadius: uiGeometry.radius.card,
  },
  bandDanger: {
    borderColor: uiRoles.danger,
  },
  message: {
    flex: 1,
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  messageDanger: {
    fontWeight: '600',
    color: uiRoles.danger,
  },
});
