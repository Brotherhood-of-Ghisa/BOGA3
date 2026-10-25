import { useRef, useState, type ReactNode } from 'react';
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
import { Icon } from '@/components/ui/icon';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';

export type TodayCardPage = {
  key: string;
  /** The page's tab label: `Progress`, or the group's name. */
  label: string;
  /** The card's body; it fills the card, which scrolls only if it cannot fit. */
  content: ReactNode;
  /** The link row closing the card (`Sessions`, `View group`). */
  footer: { label: string; onPress: () => void; testID: string };
  /** Beside the tabs while this page shows (the group switch). */
  accessory?: ReactNode;
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
 * Today's cards layout: one full-height card per page, swiped between, the
 * next one peeking at the edge. Tabs over the cards name each page and move to
 * it on tap, so swiping is never the only way there. Each card owns the height
 * between the tabs and the tab bar; its body is laid out to fill it, and
 * scrolls instead of clipping when it cannot.
 */
export function TodayCards({ pages, testID }: { pages: TodayCardPage[]; testID: string }) {
  const window = useWindowDimensions();
  const [width, setWidth] = useState(window.width);
  // A horizontal scroller sizes its content to the content, so the cards take
  // the pager's measured height explicitly. Until it is measured (and in
  // Jest), they size to their bodies.
  const [pagerHeight, setPagerHeight] = useState<number | null>(null);
  const [page, setPage] = useState(0);
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
  const cardHeight = pagerHeight === null ? undefined : Math.max(0, pagerHeight - TRACK_PADDING_TOP - TRACK_PADDING_BOTTOM);
  const onSettle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(pageAtOffset(event.nativeEvent.contentOffset.x, interval, pages.length));
  };
  const goTo = (index: number) => {
    setPage(index);
    scroller.current?.scrollTo({ x: index * interval, animated: true });
  };
  const accessory = pages[page]?.accessory;

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
        <View style={styles.accessory}>{accessory}</View>
      </View>
      <ScrollView
        contentContainerStyle={styles.track}
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
          <Card key={candidate.key} style={{ width: cardWidth, height: cardHeight }} testID={candidate.testID}>
            <ScrollView
              alwaysBounceVertical={false}
              contentContainerStyle={styles.body}
              showsVerticalScrollIndicator={false}>
              {candidate.content}
            </ScrollView>
            <FooterLink {...candidate.footer} />
          </Card>
        ))}
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

function FooterLink({ label, onPress, testID }: TodayCardPage['footer']) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [styles.footer, pressed ? styles.pressed : null]}
      testID={testID}>
      <Text allowFontScaling={false} style={styles.footerLabel}>
        {label}
      </Text>
      <Icon color={uiRoles.inkMuted} name="chevron-right" size="sm" />
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
  // The tabs, then (outside the tab list) the showing page's own control.
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
  accessory: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
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
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: uiGeometry.tapTarget + 4,
    paddingHorizontal: uiSpace.md,
    borderTopWidth: 1,
    borderTopColor: uiRoles.ruleSoft,
  },
  pressed: {
    backgroundColor: uiRoles.paper,
  },
  footerLabel: {
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
});
