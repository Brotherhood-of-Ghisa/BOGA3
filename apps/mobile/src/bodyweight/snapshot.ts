// Validation for derived session context. No stored session override is accepted.
export type SessionWeightSnapshot = {
  bodyWeightKg: number | null;
  bodyWeightSource: string | null;
  bodyWeightMeasurementId: string | null;
  bodyWeightMeasuredAt: Date | null;
};
export type SessionWeightContext = Partial<SessionWeightSnapshot>;

export function isValidSessionWeight(snapshot: Partial<SessionWeightSnapshot>): boolean {
  const { bodyWeightKg: kg, bodyWeightSource: source, bodyWeightMeasurementId: id, bodyWeightMeasuredAt: at } = snapshot;
  if (typeof kg !== 'number' || !Number.isFinite(kg) || kg <= 0) return false;
  return source === 'reading' &&
    typeof id === 'string' && id.trim().length > 0 && at instanceof Date && Number.isFinite(at.getTime());
}

/** DB readers supply the full tuple. Pure calculation inputs may supply only B. */
export function sessionBodyWeightForCalculation(session?: SessionWeightContext | null): number | null {
  if (!session) return null;
  const kg = session.bodyWeightKg;
  if (typeof kg !== 'number' || !Number.isFinite(kg) || kg <= 0) return null;
  const hasProvenance = 'bodyWeightSource' in session || 'bodyWeightMeasurementId' in session || 'bodyWeightMeasuredAt' in session;
  return hasProvenance && !isValidSessionWeight(session) ? null : kg;
}
