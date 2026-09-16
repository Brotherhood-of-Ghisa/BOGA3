import { Redirect } from 'expo-router';

/** Temporary M26 adapter until the More hub ships in T05. */
export default function MoreRouteAdapter() {
  return <Redirect href="/settings" />;
}
