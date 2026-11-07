import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Card } from '@/components/ui/card';
import { CompactHeader } from '@/components/ui/compact-card';
import { makeStyles } from '@/components/ui/theme-context';
import { uiGeometry, uiSpace } from '@/components/ui/tokens';

type ListCardProps = {
  header: ReactNode;
  columnLabels?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Embedded inside an existing Card, with no second surface. */
  variant?: 'standalone' | 'embedded';
  testID?: string;
  regionTestID?: string;
} & (
  | { onPress: () => void; accessibilityLabel: string; accessibilityHint?: string }
  | { onPress?: undefined; accessibilityLabel?: string; accessibilityHint?: undefined }
);

/** Fixed list composition. Only the board region owns the optional action. */
export function ListCard({ header, columnLabels, children, footer, variant = 'standalone', testID,
  regionTestID, onPress, accessibilityLabel, accessibilityHint }: ListCardProps) {
  const styles = useStyles();
  const body = <>{columnLabels ? <View style={styles.columns}>{columnLabels}</View> : null}{children}{footer}</>;
  const content = onPress ? <>{header}<Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel}
    accessibilityHint={accessibilityHint} onPress={onPress} testID={regionTestID}
    style={({ pressed }) => [styles.target, pressed ? styles.pressed : null]}>{body}</Pressable></>
    : <View accessible={accessibilityLabel ? true : undefined} accessibilityLabel={accessibilityLabel} testID={regionTestID}>{header}{body}</View>;
  return variant === 'embedded' ? <View style={styles.list} testID={testID}>{content}</View>
    : <Card testID={testID} style={[styles.list, styles.standalone]}>{content}</Card>;
}

/** Metadata stays beside the label; the trailing slot is reserved for a column label. */
export function ListCardHeader({ label, metadata, metadataTestID, trailing }: {
  label: string; metadata?: string; metadataTestID?: string; trailing?: ReactNode;
}) {
  const styles = useStyles();
  return <View style={styles.header}>
    <View style={styles.heading}><CompactHeader label={label} metadata={metadata} metadataPlacement="inline" metadataTestID={metadataTestID} /></View>
    {trailing}
  </View>;
}

const useStyles = makeStyles((roles) => ({
  list: { paddingBottom: uiSpace.sm },
  standalone: { paddingTop: uiSpace.xs, paddingBottom: uiSpace.md },
  target: { minHeight: uiGeometry.tapTarget },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: uiSpace.sm,
    paddingHorizontal: uiSpace.md, paddingTop: uiSpace.sm, paddingBottom: uiSpace.xs },
  heading: { flex: 1, minWidth: 0 },
  columns: { flexDirection: 'row', justifyContent: 'flex-end', gap: uiSpace.sm, paddingHorizontal: uiSpace.md },
  pressed: { backgroundColor: roles.paper },
}));
