import type { UiRoles } from '@/components/ui/theme';
import { uiRoles } from '@/components/ui/tokens';

// The one rule for a change against an earlier period (`design-language.md`
// §6): which direction it went, and the colour that says so. Every screen that
// draws a change takes its colour from here — Progress's Change column,
// Today's progress pace, the session summary's volume against its median — so one
// direction never reads two ways.
//
// `new` is an improvement: a figure that had no earlier value to fall from.
// `neutral` covers no change and an unavailable comparison, which have no
// direction and stay in ink.
export type ChangeTone = 'positive' | 'negative' | 'neutral' | 'new';

/**
 * A change's ink in `roles`. Colour is never the only channel: the figure
 * carries its sign (`+3`, `−12%`, or a plain `0`) whatever this returns, so the
 * direction still reads without hue.
 */
export const changeToneInk = (roles: UiRoles, tone: ChangeTone): string => {
  switch (tone) {
    case 'positive':
    case 'new':
      return roles.gain;
    case 'negative':
      return roles.loss;
    case 'neutral':
      return roles.ink;
  }
};

/** A change's ink as this launch drew it; a module not yet migrated reads this. */
export const changeToneColour = (tone: ChangeTone): string => changeToneInk(uiRoles, tone);
