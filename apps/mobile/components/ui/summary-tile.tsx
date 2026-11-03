import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { Card } from '@/components/ui/card';
import { CompactHeader } from '@/components/ui/compact-card';
import { uiSpace } from '@/components/ui/tokens';

type SummaryTileProps = {
  title: string;
  metrics: ReactNode;
  testID?: string;
  titleTestID?: string;
};

/** Headline metrics in the Group stats frame; WeekFigure/Stat retain their presentation. */
export function SummaryTile({ title, metrics, testID, titleTestID }: SummaryTileProps) {
  return <Card style={styles.tile} testID={testID}>
    <CompactHeader label={title} labelTestID={titleTestID} accessibilityRole="header" />
    {metrics}
  </Card>;
}

const styles = StyleSheet.create({
  tile: { padding: uiSpace.md, gap: uiSpace.sm },
});
