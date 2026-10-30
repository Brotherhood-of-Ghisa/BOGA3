// Connects the preferences store's synced fields to the settings row, which
// src/preferences may not import. Imported for its effect by the auth service,
// so it runs at startup. Calls go through the module at call time.
import { readMuscleTargetSettings, writeMuscleTargetSettings } from '@/src/data/user-settings';
import { configureSyncedPreferenceStore } from '@/src/preferences/account-local';

configureSyncedPreferenceStore({
  read: accountUserId => readMuscleTargetSettings(accountUserId),
  write: values => writeMuscleTargetSettings(values),
});
