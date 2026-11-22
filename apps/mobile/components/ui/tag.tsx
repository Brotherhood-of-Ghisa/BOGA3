import { Text, View } from 'react-native';

import { uiHairline } from '@/components/ui/edge';
import { useUiText } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import { uiGeometry, uiSpace } from '@/components/ui/tokens';

// `neutral`: a fact about the row (`Archived`, a role). `faint`: a row that has
// stepped back (`Deleted`), drawn fainter still.
export type TagTone = 'neutral' | 'faint';

export type TagProps = {
  label: string;
  tone?: TagTone;
  testID?: string;
};

// A static pill naming a state in words (`Archived`, `Deleted`, `Admin`), so
// the state never rides colour alone. Not pressable, so it takes the edge's
// hairline without the lift: a lifted pill would read as a control.
export function Tag({ label, tone = 'neutral', testID }: TagProps) {
  const styles = useStyles();
  const textRoles = useUiText();
  return (
    <View style={[styles.tag, tone === 'faint' ? styles.tagFaint : null]} testID={testID}>
      <Text allowFontScaling={false} style={[textRoles.label, tone === 'faint' ? styles.labelFaint : null]}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((roles) => ({
  tag: {
    alignSelf: 'flex-start',
    paddingHorizontal: uiSpace.sm,
    ...uiHairline(roles),
    borderRadius: uiGeometry.radius.pill,
    backgroundColor: roles.surface,
  },
  tagFaint: {
    borderColor: roles.ruleSoft,
  },
  labelFaint: {
    color: roles.inkFaint,
  },
}));
