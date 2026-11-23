import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { uiEdge } from '@/components/ui/edge';
import { OnCard, useUiGround } from '@/components/ui/ground';
import { Icon, type IconName } from '@/components/ui/icon';
import { useUiText } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import { uiGeometry, uiSpace } from '@/components/ui/tokens';

// `neutral`: information — offline, saved, unavailable. `danger`: something
// failed. There is no success or warning hue: the glyph and the words carry the
// state (`design-language.md` §5).
export type NoticeTone = 'neutral' | 'danger';

export type NoticeProps = {
  message: string;
  // A short heading above the message ("Sign-in unavailable"), when the
  // message is a reason that needs naming.
  title?: string;
  tone?: NoticeTone;
  // `offline`, `success`, `warning`… Omit for words alone.
  icon?: IconName;
  // Announce the notice when it appears (an outcome, a status change).
  live?: boolean;
  // A control that belongs to the notice, e.g. `Retry`.
  action?: ReactNode;
  testID?: string;
};

// A band that states something about the screen: inside the edge at the card
// radius, an optional leading glyph and the words. On the page it is `paper`
// with the page inks; inside a card, the card's `inset` with the inks. A
// failure stands on a card's `surface`, where `danger` reads in every theme.
export function Notice({ message, title, tone = 'neutral', icon, live = false, action, testID }: NoticeProps) {
  const styles = useStyles();
  const textRoles = useUiText();
  const danger = tone === 'danger';
  const onPage = useUiGround() === 'page';
  // The neutral band's words: the page inks only on the page's own ground.
  const neutral = onPage ? styles.pageWords : null;
  const words = (
    <Text allowFontScaling={false} style={[textRoles.body, title ? null : styles.fill, danger ? styles.messageDanger : neutral]}>{message}</Text>
  );
  return (
    <View
      accessibilityLiveRegion={live ? 'polite' : undefined}
      accessibilityRole={danger ? 'alert' : undefined}
      style={[styles.band, onPage ? null : styles.bandOnCard, title ? styles.bandTitled : null, danger ? styles.bandDanger : null]}
      testID={testID}>
      {icon ? <Icon colorRole={danger ? 'danger' : onPage ? 'pageInkMuted' : 'inkMuted'} name={icon} size="sm" /> : null}
      {title ? (
        <View style={styles.words}>
          <Text allowFontScaling={false} accessibilityRole="header" style={[textRoles.title, danger ? styles.messageDanger : neutral]}>
            {title}
          </Text>
          {words}
        </View>
      ) : (
        words
      )}
      {danger ? <OnCard>{action}</OnCard> : action}
    </View>
  );
}

const useStyles = makeStyles((roles, mode) => ({
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md,
    paddingVertical: uiSpace.sm,
    backgroundColor: roles.paper,
    ...uiEdge(roles, mode),
    borderRadius: uiGeometry.radius.card,
  },
  // A titled notice reads top-down: the glyph sits level with the title.
  bandTitled: {
    alignItems: 'flex-start',
  },
  bandOnCard: {
    backgroundColor: roles.inset,
  },
  bandDanger: {
    backgroundColor: roles.surface,
    borderColor: roles.danger,
  },
  pageWords: {
    color: roles.pageInk,
  },
  words: {
    flex: 1,
    gap: uiSpace.xs,
  },
  fill: {
    flex: 1,
  },
  messageDanger: {
    fontWeight: '600',
    color: roles.danger,
  },
}));
