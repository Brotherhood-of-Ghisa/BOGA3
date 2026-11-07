import { useTextRoles } from '@/components/ui';

/**
 * A board or record score: a figure in the slot's figure role, or — when the
 * score is `Score unavailable`, words with no figure — the slot's word role,
 * muted, since words never take the figure face (`design-language.md` §3).
 * `scoreStyle(label, size)` is the style for one score.
 */
export function useScoreStyle() {
  const { text, tone } = useTextRoles();
  return (label: string, size: 'large' | 'base' | 'small') => {
    const available = scoreHasFigure(label);
    if (size === 'small') return available ? text.figureSmall : text.meta;
    if (available) return size === 'large' ? text.figureLarge : text.figure;
    return [text.body, tone.muted];
  };
}

/** Whether a score label carries a figure (and so can take the record tone). */
export const scoreHasFigure = (label: string): boolean => /\d/.test(label);
