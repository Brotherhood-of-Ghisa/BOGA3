-- A session Volume is the sum over the sets whose load can be calculated, so
-- every facts row is a full Volume and the completeness flag goes. The rules
-- version bump in exercise-session-facts-derive.ts rebuilds the rows.
ALTER TABLE `exercise_session_facts` DROP COLUMN `volume_complete`;
