// Pure snapshot validation shared by readers. No UI, persistence or runtime imports.
export type SessionWeightSnapshot = {
  bodyWeightKg: number | null;
  bodyWeightSource: string | null;
  bodyWeightMeasurementId: string | null;
  bodyWeightMeasuredAt: Date | null;
};
export type SessionWeightContext = Partial<SessionWeightSnapshot> & { localBodyweightMetadataKnown?: boolean };

export function isValidSessionWeight(snapshot: Partial<SessionWeightSnapshot>): boolean {
  const { bodyWeightKg: kg, bodyWeightSource: source, bodyWeightMeasurementId: id, bodyWeightMeasuredAt: at } = snapshot;
  if (typeof kg !== 'number' || !Number.isFinite(kg) || kg <= 0) return false;
  if (source === 'manual') return id == null && at == null;
  return (source === 'reading' || source === 'historical_estimate') &&
    typeof id === 'string' && id.trim().length > 0 && at instanceof Date && Number.isFinite(at.getTime());
}

/** DB readers supply the full tuple. Pure calculation inputs may supply only B. */
export function sessionBodyWeightForCalculation(session?: SessionWeightContext | null): number | null {
  if (!session || session.localBodyweightMetadataKnown === false) return null;
  const kg = session.bodyWeightKg;
  if (typeof kg !== 'number' || !Number.isFinite(kg) || kg <= 0) return null;
  const hasProvenance = 'bodyWeightSource' in session || 'bodyWeightMeasurementId' in session || 'bodyWeightMeasuredAt' in session;
  return hasProvenance && !isValidSessionWeight(session) ? null : kg;
}
