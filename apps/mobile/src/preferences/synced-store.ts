// Connects the preferences store's synced fields to the settings row. Imported
// for its effect by the auth service and the preference hooks, so it runs
// before any preferences load. Calls go through the module at call time.
import { readMuscleTargetSettings, writeMuscleTargetSettings } from '../data/user-settings';
import { configureSyncedPreferenceStore } from './account-local';

configureSyncedPreferenceStore({
  read: accountUserId => readMuscleTargetSettings(accountUserId),
  write: values => writeMuscleTargetSettings(values),
});
