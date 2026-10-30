import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { SwipePages, type SwipePageFrame } from '@/components/ui/swipe-pages';

export { pageAtOffset } from '@/components/ui/swipe-pages';

export type TodayCardPage = {
  key: string;
  /** The page's tab label: `Plan`, `You` or `Groups`. */
  label: string;
  /** The page's body. It draws its own cards, unless `framed`. */
  content: ReactNode;
  /** A panel (loading, empty, an error): the page draws one card around it, which scrolls only if it cannot fit. */
  framed: boolean;
  testID: string;
};

/**
 * Today: one full-height page per tab, swiped between (`SwipePages`), the
 * cards using the full width. A page draws its own cards (You: progress
 * and session; a group: board and sessions); a panel gets one card. Each card
 * owns the height between the tabs and the tab bar; its body is laid out to
 * fill it, and scrolls instead of clipping when it cannot.
 */
export function TodayCards({ pages, initialPage = 0, testID }: { pages: TodayCardPage[]; initialPage?: number; testID: string }) {
  const [page, setPage] = useState(initialPage);
  return (
    <SwipePages
      onPageChange={setPage}
      page={page}
      pages={pages.map((candidate) => ({
        key: candidate.key,
        label: candidate.label,
        tabTestID: `${candidate.testID}-tab`,
        render: (frame) => <TodayPage frame={frame} page={candidate} />,
      }))}
      testID={testID}
    />
  );
}

function TodayPage({ page, frame }: { page: TodayCardPage; frame: SwipePageFrame }) {
  const size = { width: frame.width, height: frame.height };
  if (page.framed) {
    return (
      <Card style={size} testID={page.testID}>
        <ScrollView alwaysBounceVertical={false} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {page.content}
        </ScrollView>
      </Card>
    );
  }
  // Its cards fill the page; on a phone too short for their floors the page scrolls rather than clips.
  return (
    <View style={size} testID={page.testID}>
      <ScrollView
        alwaysBounceVertical={false}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        testID={`${page.testID}-scroll`}>
        {page.content}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flexGrow: 1,
  },
});
