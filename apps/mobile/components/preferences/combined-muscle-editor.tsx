import { useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { Alert, Text } from 'react-native';
import { ActionButton, ActionRow, CheckRow, FormField, FormSection, RadioRow, ValueRow, useUiText } from '@/components/ui';
import { MAX_COMBINED_MUSCLE_NAME_LENGTH } from '@/src/data/combined-muscles';
import {
  createCombinedMuscle, deleteCombinedMuscle, updateCombinedMuscle, type MuscleSetupChange,
} from '@/src/data/muscle-report-settings';
import {
  buildCombinedMuscleChecklist, canSaveCombinedMuscle, combinedMuscleMembers, muscleFamilies,
} from '@/src/preferences/muscle-setup-view';
import { MuscleSetupShell, type MuscleSetupState } from './muscle-settings';

type Target = { combinedKey: string | null; family: string | null; memberId: string | null };

/**
 * A combined muscle's editor ([[muscle.report-groups]]): its name, its family
 * (chosen when it is created, read-only after) and that family's muscles to
 * tick; a muscle in another combined muscle names it, and ticking moves it.
 * `Add combined muscle` / `Save` needs a name and one muscle and goes back;
 * an existing one can be deleted, its members back On on their own.
 */
export function CombinedMuscleEditorPage(target: Target) {
  return <MuscleSetupShell testID="settings-combined-muscle-screen">
    {({ loaded, setup }) => loaded ? <Editor loaded={loaded} setup={setup} target={target} /> : null}
  </MuscleSetupShell>;
}

type Draft = { name?: string; family?: string; ticked?: readonly string[] };

function Editor({ loaded, setup, target }: { loaded: MuscleSetupChange; setup: MuscleSetupState; target: Target }) {
  const router = useRouter();
  const text = useUiText();
  const [draft, setDraft] = useState<Draft>({});
  const existing = target.combinedKey ? loaded.definitions.find(muscle => muscle.key === target.combinedKey) ?? null : null;
  if (target.combinedKey && !existing) {
    return <Text allowFontScaling={false} style={text.meta} testID="settings-combined-muscle-missing">No such combined muscle.</Text>;
  }
  const families = muscleFamilies(loaded.rows);
  const presetFamily = existing?.family ?? (target.family && families.includes(target.family) ? target.family : null);
  const family = presetFamily ?? draft.family ?? null;
  const initialTicked = existing ? combinedMuscleMembers(loaded.rows, existing.key).map(row => row.id)
    : target.memberId ? [target.memberId] : [];
  const familyIds = new Set(loaded.rows.filter(row => row.familyName === family).map(row => row.id));
  const ticked = (draft.ticked ?? initialTicked).filter(id => familyIds.has(id));
  const name = draft.name ?? existing?.name ?? '';
  const checklist = family ? buildCombinedMuscleChecklist(loaded, family, new Set(ticked), existing?.key ?? null) : [];
  const toggle = (id: string) => setDraft(previous => ({
    ...previous, ticked: ticked.includes(id) ? ticked.filter(other => other !== id) : [...ticked, id],
  }));
  const save = async () => {
    const saved = await setup.change(() => existing
      ? updateCombinedMuscle({ key: existing.key, name, memberIds: ticked })
      : createCombinedMuscle({ name, family: family ?? '', memberIds: ticked }), { retry: false });
    if (saved) router.back();
  };
  const remove = () => Alert.alert(`Delete ${existing?.name}?`, undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => {
      void setup.change(() => deleteCombinedMuscle(existing!.key), { retry: false }).then(done => { if (done) router.back(); });
    } },
  ]);
  return <>
    <Stack.Screen options={{ title: existing?.name ?? 'New combined muscle' }} />
    <FormField autoFocus={!existing} face="text" label="Name" maxLength={MAX_COMBINED_MUSCLE_NAME_LENGTH}
      onChangeText={next => setDraft(previous => ({ ...previous, name: next }))} testID="settings-combined-muscle-name" value={name} />
    {presetFamily ? <FormSection>
      <ValueRow label="Family" testID="settings-combined-muscle-family" value={presetFamily} />
    </FormSection> : <FormSection title="Family">
      {families.map((option, index) => <RadioRow key={option} checked={option === family} divider={index > 0} label={option}
        onPress={() => setDraft(previous => ({ ...previous, family: option, ticked: option === family ? previous.ticked : [] }))} testID={`settings-combined-muscle-family-${option}`} />)}
    </FormSection>}
    {family ? <FormSection title="Muscles">
      {checklist.map((row, index) => <CheckRow key={row.id} checked={row.checked} divider={index > 0} label={row.label}
        note={row.elsewhere ? `in ${row.elsewhere}` : undefined} onPress={() => toggle(row.id)}
        testID={`settings-combined-muscle-member-${row.id}`} />)}
    </FormSection> : null}
    <ActionButton disabled={setup.busy || !family || !canSaveCombinedMuscle(name, ticked)}
      label={existing ? 'Save' : 'Add combined muscle'} onPress={() => { void save(); }}
      testID="settings-combined-muscle-save" variant="primary" />
    {existing ? <FormSection>
      <ActionRow disabled={setup.busy} kind="danger" label="Delete combined muscle" onPress={remove}
        testID="settings-combined-muscle-delete" />
    </FormSection> : null}
  </>;
}
