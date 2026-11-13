import type { InjurySide, InjuryStatus } from '@/src/data/injuries';

export type StatusPresentation = {
  key: InjuryStatus;
  label: string;
  shortLabel: string;
  description: string;
  colorRole: 'danger' | 'accent' | 'muted' | 'ink';
};

export const STATUS_PRESENTATIONS: Record<InjuryStatus, StatusPresentation> = {
  acute: {
    key: 'acute',
    label: 'Acute flare-up',
    shortLabel: 'Acute',
    description: 'Active flare-up · prominent warnings',
    colorRole: 'danger',
  },
  managing: {
    key: 'managing',
    label: 'Managing',
    shortLabel: 'Managing',
    description: 'Under active rehab · subtle badges',
    colorRole: 'accent',
  },
  monitoring: {
    key: 'monitoring',
    label: 'Monitoring',
    shortLabel: 'Monitoring',
    description: 'Recovering tissue · volume reloaded',
    colorRole: 'ink',
  },
  resolved: {
    key: 'resolved',
    label: 'Resolved',
    shortLabel: 'Resolved',
    description: 'Fully rehabilitated',
    colorRole: 'muted',
  },
};

export type PainScorePresentation = {
  score: number | null;
  scoreText: string;
  bandLabel: string;
  spoken: string;
  colorRole: 'danger' | 'accent' | 'muted' | 'ink';
};

export function describePainScore(score: number | null): PainScorePresentation {
  if (score === null || score === undefined) {
    return {
      score: null,
      scoreText: 'None',
      bandLabel: 'Not rated',
      spoken: 'Pain not rated',
      colorRole: 'muted',
    };
  }

  if (score === 0) {
    return {
      score: 0,
      scoreText: '0/10',
      bandLabel: 'No pain',
      spoken: 'Zero out of ten, no pain',
      colorRole: 'muted',
    };
  }

  if (score <= 3) {
    return {
      score,
      scoreText: `${score}/10`,
      bandLabel: 'Mild / Niggle',
      spoken: `${score} out of ten, mild pain or niggle`,
      colorRole: 'ink',
    };
  }

  if (score <= 6) {
    return {
      score,
      scoreText: `${score}/10`,
      bandLabel: 'Moderate / Impairs movement',
      spoken: `${score} out of ten, moderate pain impairing movement`,
      colorRole: 'accent',
    };
  }

  return {
    score,
    scoreText: `${score}/10`,
    bandLabel: 'Severe / Cannot load',
    spoken: `${score} out of ten, severe pain, cannot load`,
    colorRole: 'danger',
  };
}

export function formatPainSlider(value: number): string {
  if (value === 0) return '0 · None';
  if (value <= 3) return `${value} · Mild`;
  if (value <= 6) return `${value} · Mod`;
  return `${value} · Severe`;
}

export function formatSide(side: InjurySide | null | undefined): string {
  if (!side) return '';
  switch (side) {
    case 'left':
      return 'Left';
    case 'right':
      return 'Right';
    case 'bilateral':
      return 'Bilateral';
  }
}

export function formatInjuryAnatomy(muscleGroupName: string | null, side: InjurySide | null): string {
  const sideLabel = formatSide(side);
  if (sideLabel && muscleGroupName) {
    return `${sideLabel} ${muscleGroupName}`;
  }
  if (muscleGroupName) {
    return muscleGroupName;
  }
  if (sideLabel) {
    return `${sideLabel} side`;
  }
  return 'Unspecified anatomy';
}
