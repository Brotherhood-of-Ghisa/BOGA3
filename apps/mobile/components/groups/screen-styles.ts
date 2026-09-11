import { StyleSheet } from 'react-native';

import { uiColors, uiSpace } from '@/components/ui';

/** Shared page shell for the group routes. */
export const groupScreenStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiColors.surfacePage,
  },
  content: {
    padding: uiSpace.screen,
    gap: uiSpace.lg,
  },
  header: {
    gap: uiSpace.lg,
  },
});
