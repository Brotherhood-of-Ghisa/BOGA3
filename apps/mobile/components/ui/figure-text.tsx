import { Fragment } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

import { uiText, uiTextEmphasis } from '@/components/ui/text-roles';

// A run of digits, with the separators a figure carries inside it (`102.5`,
// `10:05`, `1,250`, `12-10-2026`). A run that starts a capitalised
// name (`1RM`) is part of that word, not a figure.
const FIGURE_RUN = /(\d+(?:[.,:-]\d+)*(?![\dA-Z]))/;

/**
 * A line of words with figures in it (`2 exercises · 3 sets`, `Started 10:05`):
 * the words keep the line's own role, each figure takes the figure face at the
 * line's size (`design-language.md` §3, "Text roles"). Render it inside the
 * line's `Text`; on an emphasised line pass `strong`, since the figure's own
 * weight would otherwise override the line's. A line drawn in a tone with a
 * weight of its own (`uiTextTone.record`) passes that tone as `figureStyle`.
 */
export function FigureText({
  children,
  strong = false,
  figureStyle,
}: {
  children: string;
  strong?: boolean;
  figureStyle?: StyleProp<TextStyle>;
}) {
  return children.split(FIGURE_RUN).map((part, index) =>
    index % 2 === 1 ? (
      <Text allowFontScaling={false} key={index} style={[uiText.inlineFigure, strong ? uiTextEmphasis.strong : null, figureStyle]}>
        {part}
      </Text>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
