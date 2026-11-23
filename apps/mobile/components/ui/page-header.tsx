import { Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { useUiGround } from '@/components/ui/ground';
import { uiTextFor, useUiText } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import { uiSpace } from '@/components/ui/tokens';

type PageHeaderProps = {
  title: string;
};

// A tab screen's in-content title (the tab screens have no native header):
// Archivo 800 at `xxl`, standing alone ([[copy.no-subtitles]]).
export function PageHeader({ title }: PageHeaderProps) {
  const styles = useStyles();
  const textRoles = useUiText();
  return (
    <View style={styles.page}>
      <Text allowFontScaling={false} accessibilityRole="header" style={textRoles.pageTitle}>
        {title}
      </Text>
    </View>
  );
}

type SectionHeaderProps = {
  title: string;
  // A way to the full view of the section ("View groups"): a caps text button,
  // never the screen's primary.
  action?: { label: string; onPress: () => void; testID?: string; accessibilityLabel?: string };
};

// A section's heading inside a screen: Archivo 700 at `lg`, in `pageInk` on
// the page, with an optional text action on the right.
export function SectionHeader({ title, action }: SectionHeaderProps) {
  const styles = useStyles();
  const onPage = useUiGround() === 'page';
  return (
    <View style={styles.section}>
      <Text allowFontScaling={false} accessibilityRole="header" style={[styles.sectionTitle, onPage ? styles.onPage : null]}>
        {title}
      </Text>
      {action ? (
        <ActionButton
          accessibilityLabel={action.accessibilityLabel}
          label={action.label}
          onPress={action.onPress}
          testID={action.testID}
          variant="text"
        />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((roles) => ({
  page: {
    gap: uiSpace.xs,
  },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  sectionTitle: {
    ...uiTextFor(roles).title,
    flex: 1,
  },
  onPage: { color: roles.pageInk },
}));
