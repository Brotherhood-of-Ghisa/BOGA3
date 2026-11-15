import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { ListRow } from '@/components/ui/list-row';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import { uiGeometry, uiSpace } from '@/components/ui/tokens';

export type SliderRowProps = {
  label: string;
  value: number;
  // The range, and the step a value moves in (default 0 and 1). A value
  // outside the range shows as it is, its thumb at the nearer end.
  min?: number;
  max: number;
  step?: number;
  // What the row shows, and VoiceOver hears, for a value.
  format: (value: number) => string;
  onChange: (value: number) => void;
  // The value the slider was let go at: the end of a drag or a tap, or one
  // VoiceOver step. A touch that turns into a page scroll reports nothing.
  onChangeEnd: (value: number) => void;
  divider?: boolean;
  // A track painted in these colours, left to right, in place of the plain
  // track and its fill: a hue picker's colours.
  trackColours?: readonly string[];
  // Drawn in place of the value (a swatch of the colour chosen); VoiceOver
  // still hears `format`.
  trailing?: ReactNode;
  testID: string;
};

const TRACK = 4;
// A painted track is tall enough to read its colours.
const PAINTED_TRACK = 16;
const THUMB = 24;
// Wide enough for `300%` or `White`, so every track in a section is one length.
const VALUE_WIDTH = 52;
// A step for VoiceOver's swipe up / down, as a share of the range.
const ACCESSIBILITY_STEPS = 20;
// A drag starts once the finger moves this far sideways; moving this far
// up or down first leaves the touch to the page's scroll.
const ACTIVE_X = 6;
const FAIL_Y = 10;

// The value in min…max, on a whole number of steps, under a point along a
// track this wide.
export function pointToValue(x: number, width: number, max: number, min = 0, step = 1): number {
  if (width <= 0) return min;
  const steps = Math.round(((Math.min(width, Math.max(0, x)) / width) * (max - min)) / step);
  return onStep(min + steps * step);
}

// Rounds off the binary error a fractional step adds (0.1 + 0.2).
const onStep = (value: number): number => Math.round(value * 1e6) / 1e6;
const within = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** A Settings row for a number from `min` (default 0) to `max` in steps of `step` (default 1): the label, then a track to drag or tap and the value beside it (or `trailing`). Reports every move, so the caller can repaint a preview live, and the value it is let go at. */
export function SliderRow({ label, value, min = 0, max, step = 1, format, onChange, onChangeEnd, divider = false, trackColours, trailing, testID }: SliderRowProps) {
  const styles = useStyles();
  const textRoles = useUiText();
  const textTones = useUiTextTone();
  const [width, setWidth] = useState(0);
  const at = (x: number) => pointToValue(x, width, max, min, step);
  // The gestures run their callbacks on the JS thread (`runOnJS(true)`), so
  // they call the caller's handlers directly, with a plain number.
  const drag = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-ACTIVE_X, ACTIVE_X])
    .failOffsetY([-FAIL_Y, FAIL_Y])
    .onUpdate((event) => onChange(at(event.x)))
    .onEnd((event, success) => {
      if (success) onChangeEnd(at(event.x));
    });
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((event, success) => {
      if (!success) return;
      onChange(at(event.x));
      onChangeEnd(at(event.x));
    });
  const share = max > min ? within((value - min) / (max - min), 0, 1) : 0;
  const accessibilityStep = Math.max(1, Math.round((max - min) / step / ACCESSIBILITY_STEPS)) * step;

  return (
    <ListRow density="list" divider={divider} label={label} testID={testID}>
      <View style={styles.control}>
        <GestureDetector gesture={Gesture.Exclusive(drag, tap)}>
          <View
            accessible
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            accessibilityLabel={label}
            accessibilityRole="adjustable"
            accessibilityValue={{ text: format(value) }}
            onAccessibilityAction={(event) => {
              const delta = event.nativeEvent.actionName === 'increment' ? accessibilityStep : -accessibilityStep;
              const next = onStep(within(value + delta, min, max));
              onChange(next);
              onChangeEnd(next);
            }}
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            style={styles.hit}
            testID={`${testID}-track`}>
            {trackColours ? (
              <View style={[styles.track, styles.painted]} testID={`${testID}-paint`}>
                {trackColours.map((colour, index) => (
                  <View key={index} style={[styles.paint, { backgroundColor: colour }]} />
                ))}
              </View>
            ) : (
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${share * 100}%` }]} />
              </View>
            )}
            <View style={[styles.thumb, { left: share * width - THUMB / 2 }]} />
          </View>
        </GestureDetector>
        {trailing !== undefined ? (
          <View style={styles.trailing}>{trailing}</View>
        ) : (
          <Text allowFontScaling={false} style={[textRoles.meta, textTones.muted, styles.value]} testID={`${testID}-value`}>
            {format(value)}
          </Text>
        )}
      </View>
    </ListRow>
  );
}

const useStyles = makeStyles((roles) => ({
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.md,
  },
  hit: {
    flex: 1,
    height: uiGeometry.tapTarget,
    justifyContent: 'center',
  },
  track: {
    height: TRACK,
    borderRadius: TRACK / 2,
    overflow: 'hidden',
    backgroundColor: roles.rule,
  },
  fill: {
    height: TRACK,
    backgroundColor: roles.ink,
  },
  painted: {
    flexDirection: 'row',
    height: PAINTED_TRACK,
    borderRadius: PAINTED_TRACK / 2,
  },
  paint: {
    flex: 1,
  },
  // Depth is a rule plus a ground change, never a shadow.
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 1,
    borderColor: roles.ink,
    backgroundColor: roles.surface,
  },
  value: {
    width: VALUE_WIDTH,
    textAlign: 'right',
  },
  trailing: {
    width: VALUE_WIDTH,
    alignItems: 'flex-end',
  },
}));
