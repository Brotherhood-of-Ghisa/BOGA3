import { Fragment } from 'react';
import { Text } from 'react-native';

import { uiText } from '@/components/ui/text-roles';

// A run of digits, with the separators a figure carries inside it (`102.5`,
// `10:05`, `1,250`).
const FIGURE_RUN = /(\d+(?:[.,:]\d+)*)/;

/**
 * A line of words with figures in it (`2 exercises · 3 sets`, `Started 10:05`):
 * the words keep the line's own role, each figure takes the figure face at the
 * line's size (`design-language.md` §3, "Text roles"). Render it inside the
 * line's `Text`.
 */
export function FigureText({ children }: { children: string }) {
  return children.split(FIGURE_RUN).map((part, index) =>
    index % 2 === 1 ? (
      <Text allowFontScaling={false} key={index} style={uiText.inlineFigure}>
        {part}
      </Text>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}
