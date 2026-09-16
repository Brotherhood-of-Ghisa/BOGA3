import { Redirect } from 'expo-router';

/** Temporary M26 adapter until the Today composition ships in T02. */
export default function TodayRouteAdapter() {
  return <Redirect href="/stats-history" />;
}
