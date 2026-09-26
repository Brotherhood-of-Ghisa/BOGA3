import { StyleSheet } from 'react-native';

import { uiBorder, uiColors, uiRadius, uiRoles, uiSpace, uiTypography } from '@/components/ui';

/**
 * Shared page shell for the group routes: the `Screen` / `ScreenScroll` ground
 * and gutter (`paper`, `lg` gutter, `md` between blocks), for the lists that
 * cannot be a `ScreenScroll` (a `FlatList`) and the routes not yet moved onto it.
 */
export const groupScreenStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiRoles.paper,
  },
  content: {
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  header: {
    gap: uiSpace.md,
  },
  /** A row of equal-width actions. */
  actionRow: {
    flexDirection: 'row',
    gap: uiSpace.sm,
  },
  actionRowItem: {
    flex: 1,
  },
});

/** Field styles for the group write forms (same input treatment as the profile form). */
export const groupFormStyles = StyleSheet.create({
  card: {
    padding: uiSpace.xxl,
    gap: uiSpace.md,
  },
  field: {
    gap: uiSpace.xs,
  },
  input: {
    borderWidth: uiBorder.width,
    borderColor: uiColors.borderInputStrong,
    borderRadius: uiRadius.md,
    backgroundColor: uiColors.surfaceDefault,
    color: uiColors.textPrimary,
    minHeight: 48,
    paddingHorizontal: uiSpace.xxl,
    paddingVertical: uiSpace.lg,
    fontSize: uiTypography.size.base,
  },
  multiline: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  fieldError: {
    color: uiColors.actionDangerText,
  },
});
