import { Redirect } from 'expo-router';

// Root `/` redirects to the merged Stats/History tab.
export default function IndexRedirect() {
  return <Redirect href="/stats-history" />;
}
