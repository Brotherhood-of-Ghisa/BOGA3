// heatmap-style.ts — the layout shared by the Daily and Weekly heatmaps:
// Week-column spacing, rest cells and press feedback. Their legends, axes and
// ticks take `[text.label, tone.faint]` (`design-language.md` §2, G11).
// Neither view draws a title: the history page's selectors name what is shown.

import { StyleSheet } from 'react-native';

import type { UiRoles } from '@/components/ui/theme';
import { uiSpace } from '@/components/ui/tokens';

export const heatmapStyles = StyleSheet.create({
  weekColumn: { marginLeft: uiSpace.sm },
  // A tile or row that opens its sessions, while held (as ActionButton's press).
  pressed: { opacity: 0.7 },
});

// An empty (`viz0`) cell needs a hairline to read against `surface`.
export const heatmapRestCell = (roles: UiRoles) => ({ borderColor: roles.rule });
