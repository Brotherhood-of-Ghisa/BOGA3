-- Volume leaves out sets whose load cannot be calculated
-- ([[copy.no-inline-explanation]]), so the completeness flag goes. The rules
-- version bump in exercise-session-facts-derive.ts rebuilds the rows.
ALTER TABLE `exercise_session_facts` DROP COLUMN `volume_complete`;
