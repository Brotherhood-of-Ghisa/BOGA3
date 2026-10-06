// HeatmapLegend.tsx — the metric legend and its ramp under both heatmap views.
// Target-graded colour names the target and its 0%…100% ends, not Less…More.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';

import { HEAT_RAMP } from './heatmap-metric';
import { heatmapStyles } from './heatmap-style';

export function HeatmapLegend({ label, target = false }: { label: string; target?: boolean }) {
  return (
    <View style={styles.legend}>
      <Text allowFontScaling={false} style={heatmapStyles.legendText}>
        {target ? 'Weekly target' : label}
      </Text>
      <View style={styles.ramp}>
        <Text allowFontScaling={false} style={heatmapStyles.legendText}>
          {target ? '0%' : 'Less'}
        </Text>
        {HEAT_RAMP.map((color, i) => (
          <View
            key={color}
            style={[styles.swatch, { backgroundColor: color }, i === 0 ? styles.restSwatch : null]}
          />
        ))}
        <Text allowFontScaling={false} style={heatmapStyles.legendText}>
          {target ? '100%' : 'More'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: uiSpace.lg,
  },
  ramp: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.xs },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: uiGeometry.radius.control,
  },
  restSwatch: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: uiRoles.rule,
  },
});
