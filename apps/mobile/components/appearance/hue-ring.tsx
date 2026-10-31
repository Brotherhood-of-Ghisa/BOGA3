import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Circle, Path } from 'react-native-svg';

import { uiRoles, uiText, uiTextTone } from '@/components/ui';
import { hueName, normaliseHue, seedsFromHue } from '@/components/ui/theme-hue';

type HueRingProps = {
  hue: number;
  onChange: (hue: number) => void;
  // The hue the ring was let go at: the end of a drag or tap, or one VoiceOver step.
  onChangeEnd?: (hue: number) => void;
  size?: number;
  testID?: string;
};

const SEGMENTS = 72;
const THICKNESS = 28;
const THUMB_RADIUS = THICKNESS / 2 + 4;
// A step for VoiceOver's swipe up / down.
const ACCESSIBILITY_STEP = 10;

// Each segment is drawn in the accent that hue gives, so the ring shows the
// buttons the user can actually get (some hues lose chroma at L* 46).
const SEGMENT_COLOURS = Array.from({ length: SEGMENTS }, (_, index) =>
  seedsFromHue(((index + 0.5) * 360) / SEGMENTS).accent,
);

// The hue under a point in the ring's box: 0° at the top, clockwise.
export function pointToHue(x: number, y: number, size: number): number {
  const centre = size / 2;
  const degrees = (Math.atan2(x - centre, centre - y) * 180) / Math.PI;
  return normaliseHue(degrees);
}

// A hue picker: drag (or tap) anywhere on the ring. Reports every move, so the
// caller can repaint a preview live, and the hue it is let go at.
export function HueRing({ hue, onChange, onChangeEnd, size = 240, testID }: HueRingProps) {
  const centre = size / 2;
  const outer = centre - (THUMB_RADIUS - THICKNESS / 2) - 1;
  const inner = outer - THICKNESS;
  const middle = (outer + inner) / 2;
  const point = (degrees: number, radius: number) => {
    const radians = (degrees * Math.PI) / 180;
    return `${centre + radius * Math.sin(radians)} ${centre - radius * Math.cos(radians)}`;
  };
  const thumb = point(hue, middle).split(' ').map(Number);

  // The gesture runs its callbacks on the JS thread (`runOnJS(true)`), so they
  // call the caller's handlers directly, with a plain hue number.
  const report = (x: number, y: number) => onChange(pointToHue(x, y, size));
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((event) => report(event.x, event.y))
    .onUpdate((event) => report(event.x, event.y))
    // Fires on every ending, a tap that never activated the pan included. The
    // hue comes from the release point, not from the last render, which may lag.
    .onFinalize((event) => onChangeEnd?.(pointToHue(event.x, event.y, size)));

  return (
    <GestureDetector gesture={pan}>
      <View
        accessible
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        accessibilityLabel="Hue"
        accessibilityRole="adjustable"
        accessibilityValue={{ text: `${hueName(hue)}, ${hue} degrees` }}
        onAccessibilityAction={(event) => {
          const delta = event.nativeEvent.actionName === 'increment' ? ACCESSIBILITY_STEP : -ACCESSIBILITY_STEP;
          const next = normaliseHue(hue + delta);
          onChange(next);
          onChangeEnd?.(next);
        }}
        style={{ width: size, height: size }}
        testID={testID}>
        <Svg height={size} width={size}>
          {SEGMENT_COLOURS.map((colour, index) => {
            // Half a degree of overlap hides the seams between segments.
            const from = (index * 360) / SEGMENTS - 0.25;
            const to = ((index + 1) * 360) / SEGMENTS + 0.25;
            return (
              <Path
                d={`M ${point(from, outer)} A ${outer} ${outer} 0 0 1 ${point(to, outer)} L ${point(to, inner)} A ${inner} ${inner} 0 0 0 ${point(from, inner)} Z`}
                fill={colour}
                key={index}
              />
            );
          })}
          <Circle cx={thumb[0]} cy={thumb[1]} fill={uiRoles.surface} r={THUMB_RADIUS} stroke={uiRoles.ink} strokeWidth={1} />
          <Circle cx={thumb[0]} cy={thumb[1]} fill={seedsFromHue(hue).accent} r={THUMB_RADIUS - 4} />
        </Svg>
        <View pointerEvents="none" style={styles.centre}>
          <Text allowFontScaling={false} style={uiText.title} testID={testID ? `${testID}-name` : undefined}>
            {hueName(hue)}
          </Text>
          <Text allowFontScaling={false} style={[uiText.figure, uiTextTone.muted]}>
            {hue}°
          </Text>
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  centre: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
