import * as Sharing from 'expo-sharing';
import type { View } from 'react-native';
import { captureRef, releaseCapture } from 'react-native-view-shot';

const SESSION_SHARE_IMAGE_WIDTH_PX = 1080;

export type SessionShareCaptureDimensions = {
  width: number;
  height: number;
};

export type SessionShareImageClient = {
  isAvailableAsync(): Promise<boolean>;
  shareAsync(
    url: string,
    options?: {
      mimeType?: string;
      UTI?: string;
      dialogTitle?: string;
    }
  ): Promise<void>;
};

export const captureSessionShareImage = async (
  target: View,
  dimensions: SessionShareCaptureDimensions
): Promise<string> => {
  if (
    !Number.isFinite(dimensions.width) ||
    !Number.isFinite(dimensions.height) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0
  ) {
    throw new Error('Session share preview is not ready yet.');
  }

  return captureRef(target, {
    format: 'png',
    result: 'tmpfile',
    width: SESSION_SHARE_IMAGE_WIDTH_PX,
    height: Math.max(
      1,
      Math.round((SESSION_SHARE_IMAGE_WIDTH_PX * dimensions.height) / dimensions.width)
    ),
  });
};

export const shareSessionImage = async (
  fileUri: string,
  client: SessionShareImageClient = Sharing
): Promise<void> => {
  if (!(await client.isAvailableAsync())) {
    throw new Error('Image sharing is unavailable on this device.');
  }

  await client.shareAsync(fileUri, {
    dialogTitle: 'Share your BOGA session',
    mimeType: 'image/png',
    UTI: 'public.png',
  });
};

export const releaseSessionShareImage = (fileUri: string): void => {
  releaseCapture(fileUri);
};
