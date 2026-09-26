// HeatmapLegend.tsx — the metric legend and the Less…More ramp under both
// heatmap views.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';

import { HEAT_RAMP } from './heatmap-metric';
import { heatmapStyles } from './heatmap-style';

export function HeatmapLegend({ label }: { label: string }) {
  return (
    <View style={styles.legend}>
      <Text allowFontScaling={false} style={heatmapStyles.legendText}>
        {label}
      </Text>
      <View style={styles.ramp}>
        <Text allowFontScaling={false} style={heatmapStyles.legendText}>
          Less
        </Text>
        {HEAT_RAMP.map((color, i) => (
          <View
            key={color}
            style={[styles.swatch, { backgroundColor: color }, i === 0 ? styles.restSwatch : null]}
          />
        ))}
        <Text allowFontScaling={false} style={heatmapStyles.legendText}>
          More
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
