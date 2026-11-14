import { Pressable, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { FigureText } from '@/components/ui/figure-text';
import { Icon } from '@/components/ui/icon';
import { useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import { uiBorder, uiGeometry, uiSpace, uiTypography } from '@/components/ui/tokens';
import { InjuryBadge } from '@/components/injuries/injury-badge';
import type { TissueReloadMetrics } from '@/src/injuries/tissue-reload';

export type TissueReloadCardProps = {
  readonly metrics: readonly TissueReloadMetrics[];
  readonly selectedMuscleId?: string | null;
  readonly onSelectMuscle?: (muscleGroupId: string) => void;
  readonly testID?: string;
};

type CautionBannerProps = {
  readonly metrics: TissueReloadMetrics;
};

function ReloadCautionBanner({ metrics }: CautionBannerProps) {
  const styles = useStyles();
  const text = useUiText();

  const spikeText = metrics.spikePercent !== null
    ? `+${metrics.spikePercent}%`
    : 'New volume';

  const thresholdText = metrics.baselineWeeklyAverage > 0
    ? `exceeds 130% threshold (${metrics.cautionThreshold} sets)`
    : 'exceeds pre-injury baseline';

  return (
    <View
      accessibilityLabel={`Caution: Volume spike on ${metrics.label}. Current volume (${metrics.currentWeeklyWorkingSets} sets) ${thresholdText}.`}
      accessibilityRole="alert"
      style={styles.cautionBanner}
      testID="tissue-reload-caution-badge">
      <View style={styles.cautionHeader}>
        <Icon colorRole="danger" name="warning" size="sm" />
        <Text
          allowFontScaling={false}
          style={[text.label, styles.cautionTitle]}
          testID="tissue-reload-caution-title">
          {`Caution: Volume spike (${spikeText} over baseline)`}
        </Text>
      </View>
      <Text
        allowFontScaling={false}
        style={[text.body, styles.cautionDescription]}>
        {`Current volume (${metrics.currentWeeklyWorkingSets} sets) ${thresholdText}. Consider gradual reload to protect recovering tissue.`}
      </Text>
    </View>
  );
}

type MetricsSummaryProps = {
  readonly metrics: TissueReloadMetrics;
};

function ReloadMetricsSummary({ metrics }: MetricsSummaryProps) {
  const text = useUiText();
  const tone = useUiTextTone();
  const styles = useStyles();

  const trendText = metrics.baselineWeeklyAverage > 0
    ? metrics.spikePercent !== null && metrics.spikePercent >= 0
      ? `+${metrics.spikePercent}%`
      : `${metrics.spikePercent}%`
    : 'New baseline';

  const rehabVolumeText = metrics.currentWeeklyRehabVolumeKg > 0
    ? ` (${metrics.currentWeeklyRehabVolumeKg} kg)`
    : '';

  return (
    <View style={styles.metricsGrid}>
      <View style={styles.metricItem}>
        <Text allowFontScaling={false} style={[text.meta, tone.faint]}>
          Current Week
        </Text>
        <Text allowFontScaling={false} style={[text.bodyStrong, tone.ink]}>
          <FigureText>{`${metrics.currentWeeklyWorkingSets}`}</FigureText>
          <Text allowFontScaling={false} style={text.body}>{' working'}</Text>
          <Text allowFontScaling={false} style={[text.meta, tone.muted]}>
            {` · ${metrics.currentWeeklyRehabSets} rehab${rehabVolumeText}`}
          </Text>
        </Text>
      </View>
      <View style={styles.metricItem}>
        <Text allowFontScaling={false} style={[text.meta, tone.faint]}>
          4-Wk Pre-Injury
        </Text>
        <Text allowFontScaling={false} style={[text.bodyStrong, tone.ink]}>
          <FigureText>{`${metrics.baselineWeeklyAverage}`}</FigureText>
          <Text allowFontScaling={false} style={text.body}>{' sets/wk'}</Text>
          <Text allowFontScaling={false} style={[text.meta, tone.muted]}>
            {` (${trendText})`}
          </Text>
        </Text>
      </View>
    </View>
  );
}

type StructureRowProps = {
  readonly item: TissueReloadMetrics;
  readonly isSelected: boolean;
  readonly onSelect?: () => void;
};

function RecoveringStructureRow({ item, isSelected, onSelect }: StructureRowProps) {
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();

  const sidePrefix = item.side === 'left' ? 'Left ' : item.side === 'right' ? 'Right ' : '';
  const muscleName = item.muscleGroupName ?? item.muscleGroupId ?? 'General';
  const heading = `${sidePrefix}${muscleName}`;

  const content = (
    <View
      style={[
        styles.structureRow,
        isSelected ? styles.structureRowSelected : null,
      ]}
      testID={`tissue-reload-item-${item.injuryId}`}>
      <View style={styles.structureHeader}>
        <View style={styles.headerLeft}>
          <Text allowFontScaling={false} numberOfLines={1} style={[text.bodyStrong, tone.ink]}>
            {heading}
          </Text>
          <Text allowFontScaling={false} numberOfLines={1} style={[text.meta, tone.faint]}>
            {item.label}
          </Text>
        </View>
        <InjuryBadge
          label={item.painScore !== null ? `${item.status} · ${item.painScore}/10` : undefined}
          severity={item.status === 'acute' ? 'acute' : item.status === 'managing' ? 'managing' : 'monitoring'}
          testID={`tissue-reload-badge-${item.injuryId}`}
        />
      </View>
      <ReloadMetricsSummary metrics={item} />
      {item.isCautionAlert ? <ReloadCautionBanner metrics={item} /> : null}
    </View>
  );

  if (onSelect) {
    return (
      <Pressable
        accessibilityHint="Focuses this recovering muscle on the 3D model"
        accessibilityLabel={`View reload metrics for ${heading}. ${item.label}.`}
        accessibilityRole="button"
        onPress={onSelect}>
        {content}
      </Pressable>
    );
  }

  return content;
}

export function TissueReloadCard({
  metrics,
  selectedMuscleId,
  onSelectMuscle,
  testID = 'tissue-reload-card',
}: TissueReloadCardProps) {
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();

  if (metrics.length === 0) {
    return (
      <Card style={styles.card} testID={testID}>
        <View style={styles.cardHeader}>
          <Text allowFontScaling={false} style={[text.title, tone.ink]}>
            Tissue Reloading
          </Text>
        </View>
        <Text
          allowFontScaling={false}
          style={[text.body, tone.muted, styles.emptyText]}
          testID="tissue-reload-empty">
          No recovering structures currently tracked.
        </Text>
      </Card>
    );
  }

  return (
    <Card style={styles.card} testID={testID}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <Icon name="progress" size="sm" />
          <Text allowFontScaling={false} style={[text.title, tone.ink]}>
            Tissue Reloading
          </Text>
        </View>
        <Text allowFontScaling={false} style={[text.meta, tone.faint]}>
          {`${metrics.length} ${metrics.length === 1 ? 'structure' : 'structures'}`}
        </Text>
      </View>
      <View style={styles.structureList}>
        {metrics.map(item => (
          <RecoveringStructureRow
            isSelected={item.muscleGroupId === selectedMuscleId}
            item={item}
            key={item.injuryId}
            onSelect={
              onSelectMuscle && item.muscleGroupId
                ? () => onSelectMuscle(item.muscleGroupId!)
                : undefined
            }
          />
        ))}
      </View>
    </Card>
  );
}

const useStyles = makeStyles(roles => ({
  card: {
    padding: uiSpace.md,
    gap: uiSpace.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  emptyText: {
    paddingVertical: uiSpace.sm,
  },
  structureList: {
    gap: uiSpace.sm,
  },
  structureRow: {
    padding: uiSpace.sm,
    borderRadius: uiGeometry.radius.card,
    borderWidth: uiBorder.width,
    borderColor: roles.rule,
    backgroundColor: roles.surface,
    gap: uiSpace.xs,
  },
  structureRowSelected: {
    borderColor: roles.accent,
  },
  structureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
  },
  metricsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: uiSpace.xs,
    gap: uiSpace.md,
  },
  metricItem: {
    flex: 1,
    minWidth: 0,
  },
  cautionBanner: {
    marginTop: uiSpace.xs,
    padding: uiSpace.xs,
    borderRadius: uiGeometry.radius.card,
    borderWidth: uiBorder.width,
    borderColor: roles.danger,
    backgroundColor: roles.surface,
    gap: uiSpace.xs,
  },
  cautionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  cautionTitle: {
    color: roles.danger,
    fontWeight: '600',
  },
  cautionDescription: {
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
  },
}));
