import { Redirect } from 'expo-router';

/** Temporary M26 adapter until the Train hub ships in T03. */
export default function TrainRouteAdapter() {
  return <Redirect href="/session-recorder" />;
}
