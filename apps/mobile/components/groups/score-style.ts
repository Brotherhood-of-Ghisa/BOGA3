import { uiText, uiTextTone } from '@/components/ui/text-roles';

/**
 * A board or record score: a figure in the slot's figure role, or — when the
 * score is `Score unavailable`, words with no figure — the slot's word role,
 * muted, since words never take the figure face (`design-language.md` §3).
 */
export function scoreStyle(label: string, size: 'large' | 'base' | 'small') {
  const available = /\d/.test(label);
  if (size === 'small') return available ? uiText.figureSmall : uiText.meta;
  if (available) return size === 'large' ? uiText.figureLarge : uiText.figure;
  return [uiText.body, uiTextTone.muted];
}

/** Whether a score label carries a figure (and so can take the record tone). */
export const scoreHasFigure = (label: string): boolean => /\d/.test(label);
