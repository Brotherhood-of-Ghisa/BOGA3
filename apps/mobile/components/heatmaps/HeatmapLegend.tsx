// Colour reference above the Progress chart it explains.

import React from 'react';
import { Text, View } from 'react-native';

import { useUiGroundTone, useUiText } from '@/components/ui/text-roles';
import { makeStyles, useUiRoles } from '@/components/ui/theme-context';
import { uiHairline } from '@/components/ui/edge';
import { uiMark } from '@/components/ui/marks';
import { uiSpace } from '@/components/ui/tokens';

import { heatRamp } from './heatmap-metric';

export function HeatmapLegend({ target = false }: { target?: boolean }) {
  const styles = useStyles();
  const roles = useUiRoles();
  const text = useUiText();
  const tone = useUiGroundTone();
  return (
    <View style={styles.legend}>
      <Text allowFontScaling={false} style={[text.label, tone.faint]}>
        {target ? '% of target' : '% of max'}
      </Text>
      <View style={styles.ramp}>
        <Text allowFontScaling={false} style={[text.label, tone.faint]}>
          0%
        </Text>
        {heatRamp(roles).map((color, i) => (
          <View
            key={color}
            style={[styles.swatch, { backgroundColor: color }, i === 0 ? styles.restSwatch : null]}
          />
        ))}
        <Text allowFontScaling={false} style={[text.label, tone.faint]}>
          100%
        </Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((roles) => ({
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: uiSpace.lg,
  },
  ramp: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.xs },
  swatch: {
    width: 12,
    height: 12,
    ...uiMark.bar,
  },
  restSwatch: uiHairline(roles, { shape: 'control' }),
}));
