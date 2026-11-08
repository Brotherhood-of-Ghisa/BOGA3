import { useState } from 'react';
import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { ListRow } from '@/components/ui/list-row';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import { uiGeometry, uiSpace } from '@/components/ui/tokens';

export type SliderRowProps = {
  label: string;
  value: number;
  max: number;
  // What the row shows, and VoiceOver hears, for a value.
  format: (value: number) => string;
  onChange: (value: number) => void;
  // The value the slider was let go at: the end of a drag or a tap, or one
  // VoiceOver step. A touch that turns into a page scroll reports nothing.
  onChangeEnd: (value: number) => void;
  divider?: boolean;
  testID: string;
};

const TRACK = 4;
const THUMB = 24;
// Wide enough for `300%` or `White`, so every track in a section is one length.
const VALUE_WIDTH = 52;
// A step for VoiceOver's swipe up / down, as a share of the range.
const ACCESSIBILITY_STEPS = 20;
// A drag starts once the finger moves this far sideways; moving this far
// up or down first leaves the touch to the page's scroll.
const ACTIVE_X = 6;
const FAIL_Y = 10;

// The whole number in 0…max under a point along a track this wide.
export function pointToValue(x: number, width: number, max: number): number {
  if (width <= 0) return 0;
  return Math.round((Math.min(width, Math.max(0, x)) / width) * max);
}

/** A Settings row for a whole number from 0 to `max`: the label, then a track to drag or tap and the value beside it. Reports every move, so the caller can repaint a preview live, and the value it is let go at. */
export function SliderRow({ label, value, max, format, onChange, onChangeEnd, divider = false, testID }: SliderRowProps) {
  const styles = useStyles();
  const textRoles = useUiText();
  const textTones = useUiTextTone();
  const [width, setWidth] = useState(0);
  const at = (x: number) => pointToValue(x, width, max);
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
  const share = max > 0 ? value / max : 0;
  const step = Math.max(1, Math.round(max / ACCESSIBILITY_STEPS));

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
              const delta = event.nativeEvent.actionName === 'increment' ? step : -step;
              const next = Math.min(max, Math.max(0, value + delta));
              onChange(next);
              onChangeEnd(next);
            }}
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            style={styles.hit}
            testID={`${testID}-track`}>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${share * 100}%` }]} />
            </View>
            <View style={[styles.thumb, { left: share * width - THUMB / 2 }]} />
          </View>
        </GestureDetector>
        <Text allowFontScaling={false} style={[textRoles.meta, textTones.muted, styles.value]} testID={`${testID}-value`}>
          {format(value)}
        </Text>
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
}));
