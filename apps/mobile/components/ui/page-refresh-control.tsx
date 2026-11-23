import { RefreshControl, type RefreshControlProps } from 'react-native';

import { useUiRoles } from '@/components/ui/theme-context';

/**
 * Pull to refresh, the one way a screen offers it. iOS turns the spinner
 * straight on the page, so it takes `pageInkMuted`: the system grey does not
 * read on Ink + paper's dark page. Android turns it on its own disc, drawn as
 * a card.
 */
export function PageRefreshControl(props: RefreshControlProps) {
  const roles = useUiRoles();
  return <RefreshControl {...props} colors={[roles.ink]} progressBackgroundColor={roles.surface} tintColor={roles.pageInkMuted} />;
}
