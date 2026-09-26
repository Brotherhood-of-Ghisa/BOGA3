import { Notice } from '@/components/ui';

type GroupWriteNoticeProps = {
  tone: 'error' | 'success';
  message: string;
  testID: string;
};

/**
 * Inline outcome of a group write: the failure (nothing changed) in `danger`,
 * or the confirmation with the `success` glyph. No success hue (G3): the glyph
 * and the words carry it.
 */
export function GroupWriteNotice({ tone, message, testID }: GroupWriteNoticeProps) {
  return tone === 'error' ? (
    <Notice live message={message} testID={testID} tone="danger" />
  ) : (
    <Notice icon="success" live message={message} testID={testID} />
  );
}
