/**
 * Training policy embedded in the app bundle. Edit this file to change the
 * defaults; these are not user preferences and have no Settings controls.
 */
export const EFFORT_LOGGING_POLICY = {
  /** Picker/cycle offers RIR 0 through this value. Existing higher RIRs stay valid. */
  maxSelectableRir: 3,
} as const;

for (const [name, value] of Object.entries({
  maxSelectableRir: EFFORT_LOGGING_POLICY.maxSelectableRir,
})) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Training policy ${name} must be a non-negative safe integer`);
  }
}
