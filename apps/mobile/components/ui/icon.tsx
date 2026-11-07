import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';

import { ICON_GLYPHS, type IconName, type IconPaint, type IconShape } from '@/components/ui/icon-glyphs';
import { useUiRoles } from '@/components/ui/theme-context';
import { uiIconSize, type UiIconSizeToken, type UiRoleToken } from '@/components/ui/tokens';

export type { IconName } from '@/components/ui/icon-glyphs';

// What the glyph is drawn in: a colour role by name, which follows the theme
// (`colorRole="inkMuted"`), or a colour already read from `useUiRoles()`. Neither:
// the glyph's own role (below), else `ink`.
type IconColour = { colorRole?: UiRoleToken; color?: never } | { color?: string; colorRole?: never };

export type IconProps = IconColour & {
  name: IconName;
  size?: UiIconSizeToken;
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
// otherwise; everything else is `ink`.
const DEFAULT_ROLES: Partial<Record<IconName, UiRoleToken>> = {
  'set-done': 'ink',
  'set-current': 'accent',
  'set-planned': 'inkGhost',
};

// A `knockout` mark is the mark cut into a glyph's own fill, which is `ink`
// unless told otherwise (`set-done`'s tick), so it is drawn in `onInk`.
type Paint = { color: string; knockout: string };

const paintProps = (paint: IconPaint | undefined, { color, knockout }: Paint) => {
  switch (paint) {
    case 'solid':
      return { fill: color, stroke: color };
    case 'knockout':
      return { fill: 'none', stroke: knockout };
    default:
      return { fill: 'none', stroke: color };
  }
};

const renderShape = (shape: IconShape, index: number, colours: Paint) => {
  const paint = paintProps(shape.paint, colours);
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
export function Icon({ name, size = 'md', colorRole, color, label, testID, style }: IconProps) {
  const roles = useUiRoles();
  const edge = uiIconSize[size];
  const colours = { color: color ?? roles[colorRole ?? DEFAULT_ROLES[name] ?? 'ink'], knockout: roles.onInk };
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
        {ICON_GLYPHS[name].map((shape, index) => renderShape(shape, index, colours))}
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
