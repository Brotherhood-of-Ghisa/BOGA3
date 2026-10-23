import { StyleSheet, Text, View } from 'react-native';

import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { DEFAULT_SUGGESTION_MAX_ACCURACY_M } from '@/src/location/gym-location-matcher';
import type { SessionPositionState } from '@/src/location/session-position';

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
  no_fix: 'No accurate enough fix',
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

const formatAccuracy = (accuracyM: number | null): string =>
  accuracyM === null ? 'unknown' : `±${Math.round(accuracyM)} m`;

// Why the sheet is or is not suggesting, from the same inputs the suggestion
// used: no fix, a fix coarser than the suggestion gate, or the fix against the
// gym directory.
const suggestionOutcome = (state: SessionPositionState | null, nearbyGymCount: number | null, suggestionCount: number): string => {
  if (nearbyGymCount === null) return 'Gyms still loading';
  if (!state) return 'GPS read not started';
  if (state.status === 'reading') return `Waiting for a fix (attempt ${state.attempts})`;
  const position = state.position;
  if (!position) return GAVE_UP_COPY[state.gaveUpReason ?? 'no_fix'];
  const { accuracyM } = position;
  if (accuracyM === null || accuracyM > DEFAULT_SUGGESTION_MAX_ACCURACY_M) {
    return `Fix too coarse for the gate (±${accuracyM === null ? '?' : Math.round(accuracyM)} m > ${DEFAULT_SUGGESTION_MAX_ACCURACY_M} m)`;
  }
  if (suggestionCount === 0) return `No gym in reach of the fix (${nearbyGymCount} gyms searched)`;
  return `${suggestionCount} of ${nearbyGymCount} gyms in reach`;
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
      value: !state
        ? 'Not started'
        : state.status === 'reading'
          ? `Acquiring (attempt ${state.attempts})`
          : position
            ? `Held · ${formatAccuracy(position.accuracyM)}`
            : `Given up · ${GAVE_UP_COPY[state.gaveUpReason ?? 'no_fix']}`,
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
      <Text allowFontScaling={false} accessibilityRole="header" style={styles.title}>
        GPS state
      </Text>
      {rows.map((row, index) => (
        <View key={row.key} style={[styles.row, index > 0 ? styles.rowDivider : null]} testID={`session-gps-row-${row.key}`}>
          <Text allowFontScaling={false} style={styles.label}>{row.label}</Text>
          <Text allowFontScaling={false} style={styles.value} testID={`session-gps-value-${row.key}`}>{row.value}</Text>
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
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    letterSpacing: uiTypography.size.sm * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkMuted,
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
  label: {
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  value: {
    flexShrink: 1,
    textAlign: 'right',
    fontFamily: uiFonts.body.family,
    fontWeight: '600',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
  },
});
