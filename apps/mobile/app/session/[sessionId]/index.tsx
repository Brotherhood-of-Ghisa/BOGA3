import { useLocalSearchParams } from 'expo-router';

import { SessionViewScreen } from '@/components/session-view/session-view-screen';

const coerceParam = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;

/** The session view as a page over the tabs: a completed session's edit. */
export default function SessionViewRoute() {
  const params = useLocalSearchParams<{ sessionId?: string | string[] }>();
  return <SessionViewScreen placement="page" sessionId={coerceParam(params.sessionId)} />;
}
