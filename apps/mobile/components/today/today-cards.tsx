import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';

import { Card } from '@/components/ui/card';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

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

// The next card shows this much at the screen's edge, so the swipe is
// discoverable without a dot row.
const PEEK = uiSpace.lg;
const CARD_GAP = uiSpace.sm;

/** The page an offset settles on, given the snap interval. */
export const pageAtOffset = (offsetX: number, interval: number, pageCount: number): number =>
  interval > 0 ? Math.min(pageCount - 1, Math.max(0, Math.round(offsetX / interval))) : 0;

/**
 * Today's cards layout: one full-height page per tab, swiped between, the
 * next one peeking at the edge. A page draws its own cards (You: progress
 * and session; a group: board and sessions); a panel gets one card. Tabs over the cards name each page and move to
 * it on tap, so swiping is never the only way there. Each card owns the height
 * between the tabs and the tab bar; its body is laid out to fill it, and
 * scrolls instead of clipping when it cannot.
 */
export function TodayCards({ pages, initialPage = 0, testID }: { pages: TodayCardPage[]; initialPage?: number; testID: string }) {
  const window = useWindowDimensions();
  const [width, setWidth] = useState(window.width);
  // A horizontal scroller sizes its content to the content, so the cards take
  // the pager's measured height explicitly. Until it is measured (and in
  // Jest), they size to their bodies.
  const [pagerHeight, setPagerHeight] = useState<number | null>(null);
  const [page, setPage] = useState(initialPage);
  const scroller = useRef<ScrollViewInstance>(null);
  const cardWidth = Math.max(0, width - 2 * uiSpace.lg - PEEK);
  const interval = cardWidth + CARD_GAP;

  const onLayout = (event: LayoutChangeEvent) => {
    const measured = Math.round(event.nativeEvent.layout.width);
    if (measured > 0 && measured !== width) setWidth(measured);
  };
  const onPagerLayout = (event: LayoutChangeEvent) => {
    const measured = Math.round(event.nativeEvent.layout.height);
    if (measured > 0 && measured !== pagerHeight) setPagerHeight(measured);
  };
  // A new width moves the snap points: keep the page showing on its card.
  useEffect(() => {
    scroller.current?.scrollTo({ x: page * interval, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only a new interval re-aims; a page change scrolls itself.
  }, [interval]);
  const cardHeight = pagerHeight === null ? undefined : Math.max(0, pagerHeight - TRACK_PADDING_TOP - TRACK_PADDING_BOTTOM);
  const onSettle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(pageAtOffset(event.nativeEvent.contentOffset.x, interval, pages.length));
  };
  const goTo = (index: number) => {
    setPage(index);
    scroller.current?.scrollTo({ x: index * interval, animated: true });
  };

  return (
    <View onLayout={onLayout} style={styles.screen} testID={testID}>
      <View style={styles.header}>
        <View accessibilityRole="tablist" style={styles.tabs}>
          {pages.map((candidate, index) => (
            <Tab
              key={candidate.key}
              label={candidate.label}
              onPress={() => goTo(index)}
              selected={index === page}
              testID={`${candidate.testID}-tab`}
            />
          ))}
        </View>
      </View>
      <ScrollView
        contentContainerStyle={styles.track}
        decelerationRate="fast"
        horizontal
        contentOffset={{ x: initialPage * interval, y: 0 }}
        onLayout={onPagerLayout}
        onMomentumScrollEnd={onSettle}
        ref={scroller}
        showsHorizontalScrollIndicator={false}
        snapToAlignment="start"
        snapToInterval={interval}
        style={styles.pager}
        testID={`${testID}-pager`}>
        {pages.map((candidate) =>
          candidate.framed ? (
            <Card key={candidate.key} style={{ width: cardWidth, height: cardHeight }} testID={candidate.testID}>
              <ScrollView
                alwaysBounceVertical={false}
                contentContainerStyle={styles.body}
                showsVerticalScrollIndicator={false}>
                {candidate.content}
              </ScrollView>
            </Card>
          ) : (
            // Its cards fill the page; on a phone too short for their floors the page scrolls rather than clips.
            <View key={candidate.key} style={{ width: cardWidth, height: cardHeight }} testID={candidate.testID}>
              <ScrollView
                alwaysBounceVertical={false}
                contentContainerStyle={styles.body}
                showsVerticalScrollIndicator={false}
                testID={`${candidate.testID}-scroll`}>
                {candidate.content}
              </ScrollView>
            </View>
          ),
        )}
      </ScrollView>
    </View>
  );
}

function Tab({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID: string }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={styles.tab}
      testID={testID}>
      <Text
        allowFontScaling={false}
        ellipsizeMode="tail"
        numberOfLines={1}
        style={[styles.tabLabel, selected ? styles.tabLabelSelected : null]}>
        {label}
      </Text>
      <View style={[styles.tabMark, selected ? styles.tabMarkSelected : null]} />
    </Pressable>
  );
}

const TAB_MARK = 2;
const TRACK_PADDING_TOP = uiSpace.md;
const TRACK_PADDING_BOTTOM = uiSpace.lg;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiRoles.paper,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: uiSpace.sm,
    paddingHorizontal: uiSpace.lg,
    minHeight: uiGeometry.tapTarget,
  },
  tabs: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: uiSpace.xl,
  },
  tab: {
    flexShrink: 1,
    minWidth: uiGeometry.tapTarget,
    justifyContent: 'flex-end',
    gap: uiSpace.xs,
    paddingTop: uiSpace.sm,
  },
  tabLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.inkFaint,
  },
  tabLabelSelected: {
    color: uiRoles.ink,
  },
  tabMark: {
    height: TAB_MARK,
    borderRadius: TAB_MARK / 2,
  },
  tabMarkSelected: {
    backgroundColor: uiRoles.ink,
  },
  pager: {
    flex: 1,
  },
  track: {
    gap: CARD_GAP,
    paddingHorizontal: uiSpace.lg,
    paddingTop: TRACK_PADDING_TOP,
    paddingBottom: TRACK_PADDING_BOTTOM,
  },
  body: {
    flexGrow: 1,
  },
});
