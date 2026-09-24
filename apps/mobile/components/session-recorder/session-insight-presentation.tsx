import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { UiText, uiBorder, uiColors, uiRadius, uiSpace } from "@/components/ui";
import type { ExerciseVolumeComparison } from "@/src/session-insights";

import { ExerciseVolumeComparisonRow } from "./exercise-volume-comparison";

type Props = {
  exerciseComparisons: ExerciseVolumeComparison[];
  muscleComparisons?: ExerciseVolumeComparison[];
  testIdPrefix?: string;
};

export function SessionInsightPresentation({
  exerciseComparisons,
  muscleComparisons = [],
  testIdPrefix = "session-insight",
}: Props) {
  const [mode, setMode] = useState<"exercise" | "muscle">("exercise");
  const comparisons =
    mode === "exercise" ? exerciseComparisons : muscleComparisons;
  return (
    <View style={styles.section} testID="session-insight-presentation">
      <View accessibilityRole="tablist" style={styles.toggle}>
        {(["exercise", "muscle"] as const).map((value) => {
          const selected = mode === value;
          const label = value === "exercise" ? "By exercise" : "By muscle";
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={value}
              onPress={() => setMode(value)}
              style={[styles.option, selected && styles.selected]}
              testID={`session-insight-mode-${value}`}
            >
              <UiText variant="labelStrong">
                {selected ? `${label} (selected)` : label}
              </UiText>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.heading}>
        <UiText variant="title">
          {mode === "exercise" ? "Exercise volume" : "Muscle volume"}
        </UiText>
        <UiText variant="bodyMuted">Session vs history</UiText>
      </View>
      {comparisons.length ? (
        comparisons.map((comparison) => (
          <ExerciseVolumeComparisonRow
            comparison={comparison}
            key={`${mode}-${comparison.exerciseDefinitionId ?? comparison.exerciseName}`}
            testID={`${testIdPrefix}-${mode}-${comparison.sessionExerciseIds[0]}`}
          />
        ))
      ) : (
        <UiText variant="bodyMuted" testID="session-insight-empty">
          {mode === "muscle"
            ? "No mapped performed sets for this session."
            : "No performed sets to compare."}
        </UiText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: uiSpace.md },
  heading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: uiSpace.sm,
  },
  toggle: {
    flexDirection: "row",
    borderWidth: uiBorder.width,
    borderColor: uiColors.borderMuted,
    borderRadius: uiRadius.full,
    padding: uiSpace.xs,
  },
  option: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: uiRadius.full,
  },
  selected: { backgroundColor: uiColors.actionPrimarySubtleBg },
});
