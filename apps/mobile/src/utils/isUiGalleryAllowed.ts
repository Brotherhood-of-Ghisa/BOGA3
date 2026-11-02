import Constants, { ExecutionEnvironment } from 'expo-constants';
import { isDevMode } from '@/src/utils/isDevMode';

/** A developer client only; the fixture gallery is never an Expo Go/store surface. */
export const isUiGalleryAllowed = () => isDevMode() && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
