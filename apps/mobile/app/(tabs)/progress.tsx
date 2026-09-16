import { Redirect } from 'expo-router';

/** Temporary M26 adapter until Progress owns Stats / History in T04. */
export default function ProgressRouteAdapter() {
  return <Redirect href="/stats-history" />;
}
