import { StyleSheet } from 'react-native';

import { uiText } from '@/components/ui/text-roles';
import { uiRoles } from '@/components/ui/tokens';
import { ROOT_STACK_SCREEN_OPTIONS } from '@/components/navigation/root-stack';

describe('root stack header', () => {
  it('titles every stack route in the title role, over surface with an ink back arrow', () => {
    const { fontFamily, fontWeight, fontSize, color } = StyleSheet.flatten(uiText.title);

    expect(ROOT_STACK_SCREEN_OPTIONS.headerTitleStyle).toEqual({ fontFamily, fontWeight, fontSize, color });
    expect(ROOT_STACK_SCREEN_OPTIONS.headerStyle).toEqual({ backgroundColor: uiRoles.surface });
    expect(ROOT_STACK_SCREEN_OPTIONS.headerTintColor).toBe(uiRoles.ink);
  });
});
