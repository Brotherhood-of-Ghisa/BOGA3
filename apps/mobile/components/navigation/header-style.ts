import { useMemo } from 'react';
import type { TextStyle } from 'react-native';

import type { UiRoles } from '@/components/ui/theme';
import { useUiRoles } from '@/components/ui/theme-context';
import { useUiText } from '@/components/ui/text-roles';

/**
 * One header style on every header (`navigation-contract.md` "Header
 * titles"): the root stack's, and the Groups tab's in the tab layout.
 */
export function headerStyleOptions(roles: UiRoles, title: Pick<TextStyle, 'fontFamily' | 'fontWeight' | 'fontSize'>) {
  return {
    // The page's own `paper` ground with no shadow line, so header and
    // page read as one surface, the `title` role and the back arrow in
    // `pageInk`. The header takes no line height, so only the role's face,
    // weight and size.
    headerStyle: { backgroundColor: roles.paper },
    headerShadowVisible: false,
    headerTitleStyle: {
      fontFamily: title.fontFamily,
      fontWeight: title.fontWeight,
      fontSize: title.fontSize,
      color: roles.pageInk,
    },
    headerTintColor: roles.pageInk,
  } as const;
}

// The header style in the roles the app is drawn in now.
export function useHeaderStyleOptions() {
  const roles = useUiRoles();
  const { title } = useUiText();
  return useMemo(() => headerStyleOptions(roles, title), [roles, title]);
}
