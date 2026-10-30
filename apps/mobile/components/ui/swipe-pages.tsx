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

import { uiText, uiTextTone } from '@/components/ui/text-roles';
import { uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';

/** The box a page is drawn in: the pager's measured width and height (the height unknown until measured, and in Jest). */
export type SwipePageFrame = { width: number; height: number | undefined };

export type SwipePage = {
  key: string;
  /** The page's tab label. */
  label: string;
  /** The page, drawn in `frame`; it owns its own vertical scrolling. */
  render: (frame: SwipePageFrame) => ReactNode;
  /** `<tabTestID>` on the page's tab. */
  tabTestID: string;
};

// Both gutters between pages, so a page steps one screen width and the next
// sits just off the edge: the tabs, not a peek, say there is more.
const PAGE_GAP = 2 * uiSpace.lg;

/** The page an offset settles on, given the snap interval. */
export const pageAtOffset = (offsetX: number, interval: number, pageCount: number): number =>
  interval > 0 ? Math.min(pageCount - 1, Math.max(0, Math.round(offsetX / interval))) : 0;

export type SwipePagesProps = {
  pages: SwipePage[];
  /** The page in view. A swipe or a tab reports the next one through `onPageChange`; a new value scrolls to it. */
  page: number;
  onPageChange: (index: number) => void;
  /** Drawn between the tabs and the pages, full width (an offline banner). */
  banner?: ReactNode;
  testID: string;
};

/**
 * Full-width pages swiped between (UX pattern 15), under tabs that name each
 * page and move to it on tap, so swiping is never the only way there. Each
 * page gets the width between the gutters and the height between the tabs
 * and the bottom of the screen.
 */
export function SwipePages({ pages, page, onPageChange, banner, testID }: SwipePagesProps) {
  const window = useWindowDimensions();
  const [width, setWidth] = useState(window.width);
  // A horizontal scroller sizes its content to the content, so the pages take
  // the pager's measured height explicitly. Until it is measured (and in
  // Jest), they size to their bodies.
  const [pagerHeight, setPagerHeight] = useState<number | null>(null);
  const scroller = useRef<ScrollViewInstance>(null);
  const pageWidth = Math.max(0, width - 2 * uiSpace.lg);
  const interval = pageWidth + PAGE_GAP;
  const [initialPage] = useState(page);

  const onLayout = (event: LayoutChangeEvent) => {
    const measured = Math.round(event.nativeEvent.layout.width);
    if (measured > 0 && measured !== width) setWidth(measured);
  };
  const onPagerLayout = (event: LayoutChangeEvent) => {
    const measured = Math.round(event.nativeEvent.layout.height);
    if (measured > 0 && measured !== pagerHeight) setPagerHeight(measured);
  };
  // A new width moves the snap points: keep the page showing in place.
  useEffect(() => {
    scroller.current?.scrollTo({ x: page * interval, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only a new interval re-aims; a page change scrolls below.
  }, [interval]);
  // A page chosen by a tab or by the caller: scroll there. After a swipe this lands where the swipe settled.
  const shownPage = useRef(page);
  useEffect(() => {
    if (shownPage.current === page) return;
    shownPage.current = page;
    scroller.current?.scrollTo({ x: page * interval, animated: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- The interval effect handles a new width.
  }, [page]);
  const pageHeight = pagerHeight === null ? undefined : Math.max(0, pagerHeight - TRACK_PADDING_TOP - TRACK_PADDING_BOTTOM);
  const onSettle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const settled = pageAtOffset(event.nativeEvent.contentOffset.x, interval, pages.length);
    shownPage.current = settled;
    if (settled !== page) onPageChange(settled);
  };
  const frame = { width: pageWidth, height: pageHeight };

  return (
    <View onLayout={onLayout} style={styles.screen} testID={testID}>
      <View style={styles.header}>
        <View accessibilityRole="tablist" style={[styles.tabs, pages.length > 3 ? styles.compactTabs : null]}>
          {pages.map((candidate, index) => (
            <Tab
              compact={pages.length > 3}
              key={candidate.key}
              label={candidate.label}
              onPress={() => {
                if (index !== page) onPageChange(index);
              }}
              selected={index === page}
              testID={candidate.tabTestID}
            />
          ))}
        </View>
      </View>
      {banner}
      <ScrollView
        contentContainerStyle={styles.track}
        contentOffset={{ x: initialPage * interval, y: 0 }}
        decelerationRate="fast"
        horizontal
        onLayout={onPagerLayout}
        onMomentumScrollEnd={onSettle}
        ref={scroller}
        showsHorizontalScrollIndicator={false}
        snapToAlignment="start"
        snapToInterval={interval}
        style={styles.pager}
        testID={`${testID}-pager`}>
        {pages.map((candidate) => (
          <View key={candidate.key}>{candidate.render(frame)}</View>
        ))}
      </ScrollView>
    </View>
  );
}

function Tab({ label, selected, onPress, testID, compact }: { label: string; selected: boolean; onPress: () => void; testID: string; compact: boolean }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={styles.tab}
      testID={testID}>
      <Text
        allowFontScaling={false}
        adjustsFontSizeToFit={compact}
        minimumFontScale={0.75}
        ellipsizeMode="tail"
        numberOfLines={1}
        style={[uiText.title, selected ? null : uiTextTone.faint]}>
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
  compactTabs: { gap: uiSpace.md },
  tab: {
    flexShrink: 1,
    minWidth: uiGeometry.tapTarget,
    justifyContent: 'flex-end',
    gap: uiSpace.xs,
    paddingTop: uiSpace.sm,
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
    gap: PAGE_GAP,
    paddingHorizontal: uiSpace.lg,
    paddingTop: TRACK_PADDING_TOP,
    paddingBottom: TRACK_PADDING_BOTTOM,
  },
});
