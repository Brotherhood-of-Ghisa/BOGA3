import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';

import { uiBorder, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { formatVolume, formatWeight } from '@/src/exercise-calculations/format';
import type { SessionBreakdownExerciseRow, SessionBreakdownMuscleRow } from '@/src/session-insights';

export type BreakdownCatalogState = 'loading' | 'ready' | 'error';

const PAGES = [
  { key: 'muscle', title: 'By muscle' },
  { key: 'exercise', title: 'By exercise' },
] as const;

// A zero count in the grid is an absent value — a dash, as the Pri and Sec
// columns have always drawn one. The card's `Records` fact keeps the figure
// rule instead and shows `0` (`design-language.md` §6).
const count = (value: number): string => (value === 0 ? '—' : String(value));
const volume = (value: number | null): string => (value === null ? '—' : formatVolume(value));
const weight = (value: number | null): string => (value === null ? '—' : formatWeight(value));

const plural = (value: number, singular: string): string =>
  `${value} ${value === 1 ? singular : `${singular}s`}`;

const muscleRowLabel = (row: SessionBreakdownMuscleRow): string =>
  `${row.displayName}, ${row.primarySetCount} primary, ${row.secondarySetCount} secondary; ` +
  `volume ${volume(row.volume)}; ${plural(row.recordCount, 'record')}`;

const exerciseRowLabel = (row: SessionBreakdownExerciseRow): string =>
  `${row.name}, ${plural(row.workingSetCount, 'set')}; volume ${volume(row.volume)}; ` +
  `top weight ${weight(row.topWeight)}; ${plural(row.recordCount, 'record')}`;

function Figure({ value, total = false, wide = false }: { value: string; total?: boolean; wide?: boolean }) {
  return (
    <Text
      allowFontScaling={false}
      numberOfLines={1}
      style={[styles.figure, wide && styles.figureWide, total && styles.total, value === '—' && styles.absent]}>
      {value}
    </Text>
  );
}

function PagerDots({ page, onSelect, testID }: { page: number; onSelect: (next: number) => void; testID: string }) {
  return (
    <View accessibilityRole="tablist" style={styles.dots} testID={testID}>
      {PAGES.map((entry, index) => (
        <Pressable
          accessibilityLabel={entry.title}
          accessibilityRole="tab"
          accessibilityState={{ selected: index === page }}
          hitSlop={uiSpace.md}
          key={entry.key}
          onPress={() => onSelect(index)}
          testID={`${testID}-${entry.key}`}>
          <View style={[styles.dot, index === page && styles.dotActive]} />
        </Pressable>
      ))}
    </View>
  );
}

// A page with nothing to draw. The muscle page keeps its own wording: a failed
// catalog read breaks the muscle mapping alone, and the exercise page beside it
// still renders.
function EmptyPage({
  state = 'ready',
  loadingMessage,
  errorMessage,
  emptyMessage,
  testID,
}: {
  state?: BreakdownCatalogState;
  loadingMessage?: string;
  errorMessage?: string;
  emptyMessage: string;
  testID: string;
}) {
  return (
    <Text allowFontScaling={false} style={styles.muted} testID={testID}>
      {state === 'loading' ? loadingMessage : state === 'error' ? errorMessage : emptyMessage}
    </Text>
  );
}

function MuscleTable({ rows, testID }: { rows: SessionBreakdownMuscleRow[]; testID: string }) {
  return (
    <View testID={testID}>
      <View style={styles.row}>
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.microLabel, styles.nameCell]}>Muscle</Text>
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.microLabel, styles.cell]}>Pri</Text>
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.microLabel, styles.cell]}>Sec</Text>
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.microLabel, styles.volumeCell]}>Vol</Text>
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.microLabel, styles.cell]}>PR</Text>
      </View>
      {rows.map((row) => (
        <View
          accessibilityLabel={muscleRowLabel(row)}
          accessible
          key={row.id}
          style={[styles.row, styles.bodyRow]}
          testID={`${testID}-${row.id}`}>
          <Text allowFontScaling={false} numberOfLines={1} style={[styles.name, styles.nameCell]}>{row.displayName}</Text>
          <Figure total value={count(row.primarySetCount)} />
          <Figure total value={count(row.secondarySetCount)} />
          <Figure total value={volume(row.volume)} wide />
          <Figure value={count(row.recordCount)} />
        </View>
      ))}
    </View>
  );
}

function ExerciseTable({ rows, testID }: { rows: SessionBreakdownExerciseRow[]; testID: string }) {
  return (
    <View testID={testID}>
      <View style={styles.row}>
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.microLabel, styles.nameCell]}>Exercise</Text>
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.microLabel, styles.cell]}>Sets</Text>
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.microLabel, styles.volumeCell]}>Vol</Text>
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.microLabel, styles.volumeCell]}>Max</Text>
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.microLabel, styles.cell]}>PR</Text>
      </View>
      {rows.map((row) => (
        <View
          accessibilityLabel={exerciseRowLabel(row)}
          accessible
          key={row.id}
          style={[styles.row, styles.bodyRow]}
          testID={`${testID}-${row.id}`}>
          <Text allowFontScaling={false} numberOfLines={1} style={[styles.name, styles.nameCell]}>{row.name}</Text>
          <Figure total value={String(row.workingSetCount)} />
          <Figure total value={volume(row.volume)} wide />
          <Figure value={weight(row.topWeight)} wide />
          <Figure value={count(row.recordCount)} />
        </View>
      ))}
    </View>
  );
}

/**
 * The completion summary card's breakdown: the session by muscle, then by
 * exercise, as two pages of one horizontal pager. The gesture is never the
 * only way through — the dots are a `tablist` whose tabs page on tap, so
 * VoiceOver and a user who does not discover the swipe both reach page two.
 *
 * Replaces the card's `Sets by muscle` table, which showed sets alone. The
 * muscle page carries the primary and secondary set counts as they are; the
 * weighted total of [[muscle.set-count]] is not drawn here.
 */
export function SessionBreakdownPager({
  muscleRows,
  exerciseRows,
  catalogState = 'ready',
  testID = 'session-completion-breakdown',
}: {
  muscleRows: SessionBreakdownMuscleRow[];
  exerciseRows: SessionBreakdownExerciseRow[];
  catalogState?: BreakdownCatalogState;
  testID?: string;
}) {
  const [page, setPage] = useState(0);
  const [width, setWidth] = useState(0);
  // Each page's own content height, so the pager is as tall as the page being
  // read: the muscle page usually has more rows than the exercise page, and a
  // shared height left the shorter one trailing empty card.
  const [heights, setHeights] = useState([0, 0]);
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);

  const goToPage = (next: number) => {
    setPage(next);
    if (width > 0) scroller.current?.scrollTo({ x: next * width, animated: true });
  };
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  const onSettled = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return;
    setPage(Math.round(event.nativeEvent.contentOffset.x / width));
  };
  const pageWidth = width > 0 ? { width } : undefined;
  const onPageLayout = (index: number) => (event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    setHeights((previous) => {
      if (previous[index] === height) return previous;
      const next = [...previous];
      next[index] = height;
      return next;
    });
  };
  const pagerHeight = heights[page] > 0 ? { height: heights[page] } : undefined;

  return (
    <View style={styles.pager} testID={testID}>
      <View style={styles.header}>
        <Text allowFontScaling={false} accessibilityRole="header" style={styles.cardTitle} testID={`${testID}-title`}>
          {PAGES[page].title}
        </Text>
        <PagerDots onSelect={goToPage} page={page} testID={`${testID}-dots`} />
      </View>
      <View onLayout={onLayout}>
        <ScrollView
          horizontal
          onMomentumScrollEnd={onSettled}
          pagingEnabled
          ref={scroller}
          scrollEventThrottle={16}
          showsHorizontalScrollIndicator={false}
          style={pagerHeight}>
          {/* Each page takes the viewport's width once it is measured; before
              the first layout pass both lay out at their natural width, so the
              tables are never missing from the tree. */}
          <View style={pageWidth} testID={`${testID}-page-muscle`}>
            <View onLayout={onPageLayout(0)}>
            {muscleRows.length > 0 && catalogState === 'ready' ? (
              <MuscleTable rows={muscleRows} testID={`${testID}-muscle`} />
            ) : (
              <EmptyPage
                emptyMessage="No mapped working sets for this session."
                errorMessage="Muscle breakdown unavailable."
                loadingMessage="Loading muscle breakdown…"
                state={catalogState}
                testID={`${testID}-muscle-empty`}
              />
            )}
            </View>
          </View>
          <View style={pageWidth} testID={`${testID}-page-exercise`}>
            <View onLayout={onPageLayout(1)}>
            {exerciseRows.length > 0 ? (
              <ExerciseTable rows={exerciseRows} testID={`${testID}-exercise`} />
            ) : (
              <EmptyPage emptyMessage="No working sets to compare." testID={`${testID}-exercise-empty`} />
            )}
            </View>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pager: {
    marginHorizontal: uiSpace.md,
    paddingTop: uiSpace.sm,
    paddingBottom: uiSpace.md,
    gap: uiSpace.sm,
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  cardTitle: {
    flex: 1,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.ink,
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  dot: {
    width: uiSpace.sm,
    height: uiSpace.sm,
    borderRadius: uiGeometry.radius.pill,
    backgroundColor: uiRoles.inkGhost,
  },
  dotActive: {
    backgroundColor: uiRoles.ink,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: uiSpace.sm,
  },
  bodyRow: {
    paddingVertical: uiSpace.xs,
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
  },
  nameCell: {
    flex: 1,
    minWidth: 0,
  },
  cell: {
    width: uiGeometry.metricValueWidth,
    textAlign: 'right',
  },
  // A session Volume runs to five or six digits, which overruns the metric
  // column every other figure sits in; one spacing step buys the room.
  volumeCell: {
    width: uiGeometry.metricValueWidth + uiSpace.sm,
    textAlign: 'right',
  },
  microLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkFaint,
  },
  name: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.ink,
  },
  figureWide: {
    width: uiGeometry.metricValueWidth + uiSpace.sm,
  },
  figure: {
    width: uiGeometry.metricValueWidth,
    textAlign: 'right',
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.inkMuted,
  },
  total: {
    fontWeight: '600',
    color: uiRoles.ink,
  },
  absent: {
    color: uiRoles.inkGhost,
  },
  muted: {
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.inkMuted,
  },
});
