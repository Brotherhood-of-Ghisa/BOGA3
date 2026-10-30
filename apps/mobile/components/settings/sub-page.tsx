import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { ScreenScroll, uiSpace } from '@/components/ui';

// The body of a Settings sub page: a scroll of `FormSection`s under the native header.
export function SubPage({ children, testID }: { children: ReactNode; testID: string }) {
  return (
    <ScreenScroll
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      testID={testID}>
      {children}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: uiSpace.md,
  },
});
