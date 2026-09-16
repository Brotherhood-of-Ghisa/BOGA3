import { Redirect } from 'expo-router';

// Root `/` enters the M26 orientation surface after auth/first-sync gates.
export default function IndexRedirect() {
  return <Redirect href="/today" />;
}
