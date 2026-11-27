import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as Linking from 'expo-linking';

export type MeetLocation = { address: string; latitude: number | null; longitude: number | null };
export function meetMapsUrl(location: MeetLocation, platform = Platform.OS): string {
  const query = encodeURIComponent(location.address);
  const coords = location.latitude !== null && location.longitude !== null ? `${location.latitude},${location.longitude}` : null;
  return platform === 'ios' ? `https://maps.apple.com/?${coords ? `ll=${coords}&q=${query}` : `q=${query}`}`
    : `https://www.google.com/maps/search/?api=1&query=${coords ?? query}`;
}
export const openMeetMaps = (location: MeetLocation) => Linking.openURL(meetMapsUrl(location));
export type MeetGeocoder = Pick<typeof Location, 'geocodeAsync' | 'reverseGeocodeAsync' | 'getForegroundPermissionsAsync'>;
/** iOS CLGeocoder needs no permission; Android only uses an existing grant. Never request one. */
export async function checkMeetAddress(address: string, online: boolean, platform = Platform.OS, geocoder: MeetGeocoder = Location): Promise<MeetLocation> {
  const fallback: MeetLocation = { address, latitude: null, longitude: null };
  if (!online || !address.trim() || !['ios', 'android'].includes(platform)) return fallback;
  try {
    if (platform === 'android' && !(await geocoder.getForegroundPermissionsAsync()).granted) return fallback;
    const [match] = await geocoder.geocodeAsync(address);
    if (!match || !Number.isFinite(match.latitude) || !Number.isFinite(match.longitude)) return fallback;
    const [resolved] = await geocoder.reverseGeocodeAsync(match).catch(() => []);
    const label = resolved ? [resolved.name, resolved.street, resolved.city, resolved.region, resolved.postalCode, resolved.country].filter(Boolean).join(', ') : address;
    return { address: label || address, latitude: match.latitude, longitude: match.longitude };
  } catch { return fallback; }
}
