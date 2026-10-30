import type { ReactTestInstance } from 'react-test-renderer';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';

import { ICON_GLYPHS, type IconName } from '@/components/ui/icon-glyphs';

const SHAPES = [Path, Circle, Ellipse];

const signature = (kind: string, props: Record<string, unknown>): string =>
  kind === 'path' ? `path:${props.d}` : kind === 'circle' ? `circle:${props.cx},${props.cy},${props.r}` : `ellipse:${props.cx},${props.cy},${props.rx},${props.ry}`;

const kindOf = (node: ReactTestInstance): string => (node.type === Path ? 'path' : node.type === Circle ? 'circle' : 'ellipse');

/** Whether the icon `name` is drawn anywhere under `root`; icons are hidden from assistive tech, so queries by role cannot see them. */
export function drawsGlyph(root: ReactTestInstance, name: IconName): boolean {
  const wanted = ICON_GLYPHS[name].map((shape) => signature(shape.kind, shape as unknown as Record<string, unknown>)).join('|');
  return root
    .findAllByType(Svg)
    .some((svg) => svg.findAll((node) => SHAPES.includes(node.type as never)).map((node) => signature(kindOf(node), node.props)).join('|') === wanted);
}
