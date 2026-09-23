import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';

import { ICON_GLYPHS, type IconName, type IconPaint, type IconShape } from '@/components/ui/icon-glyphs';
import { uiColors, uiIconSize, uiRoles, type UiIconSizeToken } from '@/components/ui/tokens';

export type { IconName } from '@/components/ui/icon-glyphs';

export type IconProps = {
  name: IconName;
  size?: UiIconSizeToken;
  /** A token value (`uiColors.*` on shipped screens, `uiRoles.*` on new ones). */
  color?: string;
  /**
   * Set only when the icon itself carries meaning no surrounding text or
   * control label states: the icon then becomes an accessible image with this
   * label. Unset, it is hidden from assistive tech — the usual case, since an
   * icon inside a labelled control is decoration of that label.
   */
  label?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

// The set-state glyphs carry their design-language §5 colour unless told
// otherwise; everything else is ink on the shipped palette.
const DEFAULT_COLORS: Partial<Record<IconName, string>> = {
  'set-done': uiRoles.ink,
  'set-current': uiRoles.accent,
  'set-planned': uiRoles.planned,
};

// What a `knockout` mark is drawn in: the card ground it cuts back to.
const KNOCKOUT_COLOR = uiRoles.surface;

const paintProps = (paint: IconPaint | undefined, color: string) => {
  switch (paint) {
    case 'solid':
      return { fill: color, stroke: color };
    case 'knockout':
      return { fill: 'none', stroke: KNOCKOUT_COLOR };
    default:
      return { fill: 'none', stroke: color };
  }
};

const renderShape = (shape: IconShape, index: number, color: string) => {
  const paint = paintProps(shape.paint, color);
  switch (shape.kind) {
    case 'path':
      return <Path key={index} d={shape.d} {...paint} />;
    case 'circle':
      return <Circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} {...paint} />;
    case 'ellipse':
      return <Ellipse key={index} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} {...paint} />;
  }
};

// The app's icon set: vendored Lucide geometry plus BoGa's state glyphs
// (`icon-glyphs.ts`). Replaces the Unicode characters screens used to set in
// `Text` as improvised icons. Never takes touches — wrap it in the control.
export function Icon({ name, size = 'md', color, label, testID, style }: IconProps) {
  const edge = uiIconSize[size];
  const ink = color ?? DEFAULT_COLORS[name] ?? uiColors.textPrimary;
  const accessibility = label
    ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label }
    : {
        accessible: false,
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      };

  return (
    <View
      {...accessibility}
      pointerEvents="none"
      style={[styles.box, { width: edge, height: edge }, style]}
      testID={testID}>
      <Svg
        height={edge}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        viewBox="0 0 24 24"
        width={edge}>
        {ICON_GLYPHS[name].map((shape, index) => renderShape(shape, index, ink))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
