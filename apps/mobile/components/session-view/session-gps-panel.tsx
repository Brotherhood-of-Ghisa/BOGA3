import { StyleSheet, Text, View } from 'react-native';

import { FigureText } from '@/components/ui/figure-text';
import { uiText, uiTextEmphasis, uiTextTone } from '@/components/ui/text-roles';
import { uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';
import { DEFAULT_SUGGESTION_RADIUS_M } from '@/src/location/gym-location-matcher';
import { SESSION_POSITION_GOOD_ACCURACY_M, type SessionPositionState } from '@/src/location/session-position';

export type SessionGpsPanelProps = {
  // The session's acquisition diagnostics, or `null` before it starts.
  state: SessionPositionState | null;
  // The active gyms the suggestions search, or `null` while they load.
  nearbyGymCount: number | null;
  // How many nearby gyms the sheet is showing.
  suggestionCount: number;
};

const GAVE_UP_COPY: Record<NonNullable<SessionPositionState['gaveUpReason']>, string> = {
  permission_denied: 'Location permission denied',
  services_disabled: 'Location services are off',
  no_fix: 'No fix',
  read_error: 'Location read failed',
};

const READ_STATUS_COPY: Record<string, string> = {
  success: 'read ok',
  timeout: 'read timed out',
  read_failure: 'read failed',
  permission_denied: 'permission denied',
  unavailable: 'services off',
  unexpected_error: 'unexpected error',
};

const isGoodAccuracy = (accuracyM: number | null): boolean =>
  accuracyM !== null && accuracyM <= SESSION_POSITION_GOOD_ACCURACY_M;

const formatAccuracy = (accuracyM: number | null): string =>
  accuracyM === null ? 'unknown' : `±${Math.round(accuracyM)} m`;

// The held fix and whether reading goes on to refine it.
const fixSummary = (state: SessionPositionState | null): string => {
  if (!state) return 'Not started';
  const { position } = state;
  if (state.status === 'reading') {
    return position
      ? `Refining · ${formatAccuracy(position.accuracyM)} (attempt ${state.attempts})`
      : `Acquiring (attempt ${state.attempts})`;
  }
  if (!position) return `Given up · ${GAVE_UP_COPY[state.gaveUpReason ?? 'no_fix']}`;
  return isGoodAccuracy(position.accuracyM)
    ? `Held · ${formatAccuracy(position.accuracyM)}`
    : `Best effort · ${formatAccuracy(position.accuracyM)}`;
};

// Why the sheet is or is not suggesting, from the same inputs the suggestion
// used: no fix, or the fix against the gym directory.
const suggestionOutcome = (state: SessionPositionState | null, nearbyGymCount: number | null, suggestionCount: number): string => {
  if (nearbyGymCount === null) return 'Gyms still loading';
  if (!state) return 'GPS read not started';
  if (state.status === 'reading' && !state.position) return `Waiting for a fix (attempt ${state.attempts})`;
  if (!state.position) return GAVE_UP_COPY[state.gaveUpReason ?? 'no_fix'];
  const reach = `${DEFAULT_SUGGESTION_RADIUS_M / 1_000} km`;
  if (suggestionCount === 0) return `No gym within ${reach} (${nearbyGymCount} gyms searched)`;
  return `${suggestionCount} of ${nearbyGymCount} gyms within ${reach}`;
};

/**
 * Developer-only diagnostics for the gym sheet's nearby suggestion: what the
 * GPS reads saw, the fix the session holds, and why the sheet is or is not
 * suggesting. Rendered only behind the developer-mode flag, so it never meets
 * a lifter.
 */
export function SessionGpsPanel({ state, nearbyGymCount, suggestionCount }: SessionGpsPanelProps) {
  const position = state?.position ?? null;

  const rows: { key: string; label: string; value: string }[] = [
    {
      key: 'fix',
      label: 'Fix',
      value: fixSummary(state),
    },
    {
      key: 'last-read',
      label: 'Last read',
      value: state?.lastRead
        ? `${READ_STATUS_COPY[state.lastRead.status] ?? state.lastRead.status} · ${formatAccuracy(state.lastRead.accuracyM)}`
        : 'None yet',
    },
    {
      key: 'coordinates',
      label: 'Coordinates',
      value: position
        ? `${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)} · ${formatAccuracy(position.accuracyM)}`
        : '—',
    },
    {
      key: 'suggestions',
      label: 'Suggestions',
      value: suggestionOutcome(state, nearbyGymCount, suggestionCount),
    },
  ];

  return (
    <View style={styles.panel} testID="session-gps-panel">
      <Text allowFontScaling={false} accessibilityRole="header" style={[uiText.label, styles.title]}>
        GPS state
      </Text>
      {rows.map((row, index) => (
        <View key={row.key} style={[styles.row, index > 0 ? styles.rowDivider : null]} testID={`session-gps-row-${row.key}`}>
          <Text allowFontScaling={false} style={uiText.meta}>{row.label}</Text>
          <Text allowFontScaling={false} style={[uiText.meta, uiTextTone.ink, uiTextEmphasis.strong, styles.value]} testID={`session-gps-value-${row.key}`}><FigureText strong>{row.value}</FigureText></Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: uiRoles.paper,
    borderRadius: uiGeometry.radius.card,
    marginBottom: uiSpace.md,
    marginHorizontal: uiSpace.lg,
    padding: uiSpace.md,
  },
  title: {
    marginBottom: uiSpace.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: uiSpace.md,
    paddingVertical: uiSpace.xs,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: uiRoles.rule,
  },
  value: {
    flexShrink: 1,
    textAlign: 'right',
  },
});
