import { useState } from 'react';
import { Keyboard } from 'react-native';
import { FilterChip } from '@/components/exercise-catalog/exercise-list-controls';
import { Icon, Information, ListRow, Sheet } from '@/components/ui';
import type { MuscleOverlayStyle } from './muscle-body-projection';

export type MuscleView = 'list' | MuscleOverlayStyle;
export type MuscleViewControl = { value: MuscleView; onSelect: (next: MuscleView) => void };

const MATERIALS = [
  { value: 'contour', label: 'Patches' },
  { value: 'wireframe', label: 'Wireframe' },
] as const;

export function MuscleViewButton({ value, onSelect, showTrigger }: MuscleViewControl & { showTrigger: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    {showTrigger ? <FilterChip accessibilityLabel="Muscle view options" accessibilityRole="button" label="View"
      on={false} onPress={() => { Keyboard.dismiss(); setOpen(true); }} size="compact"
      trailing={<Icon colorRole="inkMuted" name="chevron-down" size="xs" />}
      testID="stats-muscle-list-view" /> : null}
    <MuscleViewSheet visible={open} onDismiss={() => setOpen(false)} value={value}
      onSelectList={() => onSelect('list')} onSelectOverlay={onSelect} />
  </>;
}

export function MuscleViewSheet({ visible, onDismiss, value, onSelectList, onSelectOverlay }: {
  visible: boolean;
  onDismiss: () => void;
  value: MuscleView;
  onSelectList?: () => void;
  onSelectOverlay: (next: MuscleOverlayStyle) => void;
}) {
  return <Sheet visible={visible} onDismiss={onDismiss} dismissLabel="Dismiss muscle view options"
    title="View" testID="stats-muscle-body-view-sheet">
    {onSelectList ? <ListRow label="List" checked={value === 'list'}
      onPress={() => { onDismiss(); onSelectList(); }}
      trailing={<Icon name={value === 'list' ? 'radio-on' : 'radio-off'} size="md" />}
      testID="stats-muscle-view-list" /> : null}
    {MATERIALS.map(option =>
      <ListRow key={option.value} label={option.label} checked={value === option.value}
        onPress={() => { onDismiss(); onSelectOverlay(option.value); }}
        trailing={<Icon name={value === option.value ? 'radio-on' : 'radio-off'} size="md" />}
        testID={`stats-muscle-body-material-${option.value}`} />)}
    <Information title="About the muscle model" testIDPrefix="stats-muscle-body"
      renderTrigger={open => <ListRow label="About the model" onPress={open}
        trailing={<Icon name="chevron-right" size="sm" />} />}
      body="Wireframe lines are triangle edges. Both model styles share the same coarse muscle surfaces. Muscle layers partially cover selected anatomy; several layers make it faint. Taps select the foreground body region. Shapes are visually fitted: Forearms use an outer group envelope with hand tendons; spinal erectors use smoothed columns; Abs and Lats use body-surface approximations."
      sections={[[ 'Anatomical source', 'BodyParts3D © The Database Center for Life Science, CC BY 4.0. Adapted by pose alignment, forearm/hand fitting, bilateral mirroring and simplified surface envelopes. Source and licence: https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html' ]]} />
  </Sheet>;
}
