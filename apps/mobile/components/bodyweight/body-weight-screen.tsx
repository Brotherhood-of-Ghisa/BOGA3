import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { ActionButton, Card, Icon, ListRow, Notice, ScreenScroll, StatePanel, Stat, uiRoles } from '@/components/ui';
import { deleteBodyWeightReading, listBodyWeightReadings, saveBodyWeightReading } from '@/src/data/bodyweight';
import type { BodyWeightMeasurement } from '@/src/data/schema';
import { isValidBodyWeightReading } from '@/src/bodyweight/weight-entry';
import { formatCurrentDateTime } from '@/src/session-recorder/session-model';
import { SessionWeightBackfillSheet } from './backfill-sheet';
import { WeightEntrySheet } from './weight-entry-sheet';
import { weightStyles as styles } from './styles';

type Editor = { reading: BodyWeightMeasurement | null; measuredAt: Date };
export function BodyWeightScreen() {
  const [readings, setReadings] = useState<BodyWeightMeasurement[] | null>(null);
  // When the readings were loaded: the current reading is the latest measured by then.
  const [loadedAtMs, setLoadedAtMs] = useState(0);
  const [error, setError] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [backfillVisible, setBackfillVisible] = useState(false);
  const readingAfterBackfill = useRef(false);
  const openEditor = (value: Editor) => { setEditor(value); setEditorVisible(true); };
  const finishBackfillDismissal = () => {
    if (!readingAfterBackfill.current) return;
    readingAfterBackfill.current = false;
    openEditor({ reading: null, measuredAt: new Date() });
  };
  const [feedback, setFeedback] = useState<string | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setError(false);
    try { const rows = await listBodyWeightReadings(); if (current === generation.current) { setReadings(rows); setLoadedAtMs(Date.now()); } }
    catch { if (current === generation.current) setError(true); }
  }, []);
  useFocusEffect(useCallback(() => {
    void load();
    return () => { generation.current += 1; };
  }, [load]));
  const current = readings?.find(row => row.measuredAt.getTime() <= loadedAtMs);
  const currentValid = current && isValidBodyWeightReading(current);
  return <>
    <ScreenScroll testID="body-weight-screen" contentInsetAdjustmentBehavior="automatic">
      <Text allowFontScaling={false} style={styles.body}>
        New sessions use your latest reading at their start. Saved session weights stay fixed when you add, edit or delete a reading.
      </Text>
      {feedback ? <Notice live message={feedback} testID="body-weight-feedback" /> : null}
      {error ? <StatePanel kind="error" title="Could not load weight history."
        action={{ label: 'Retry', onPress: () => void load() }} testID="body-weight-error" />
        : readings === null ? <StatePanel kind="loading" testID="body-weight-loading" /> : <>
          <Card><View style={styles.cardBody}>
            <Stat label={currentValid ? `Current body weight · ${current.weightUnit}` : 'Current body weight'}
              value={currentValid ? current.weightValue : 'Unknown'} kind={currentValid ? 'figure' : 'text'}
              testID="body-weight-current" />
            <Text allowFontScaling={false} style={styles.body}>
              {currentValid ? `Measured ${formatCurrentDateTime(current.measuredAt)}` : current
                ? 'Your latest reading needs review before it can be used.' : 'No weight recorded. Add your first reading below.'}
            </Text>
          </View></Card>
          <ActionButton label="Add reading" variant="primary" testID="body-weight-add"
            onPress={() => openEditor({ reading: null, measuredAt: new Date() })} />
          <ActionButton label="Fill missing session weights" variant="outline" testID="body-weight-backfill"
            onPress={() => setBackfillVisible(true)} />
          <View style={styles.section}>
            <Text allowFontScaling={false} accessibilityRole="header" style={styles.label}>Weight history</Text>
            {readings.length === 0 ? <Text allowFontScaling={false} style={styles.body} testID="body-weight-empty">
              No readings yet. Weight is saved on this device even when you are offline.
            </Text> : <Card>{readings.map((reading, index) => <ListRow key={reading.id}
              divider={index > 0} density="list" testID={`body-weight-reading-${reading.id}`}
              accessibilityLabel={`Edit ${reading.weightValue} ${reading.weightUnit}, ${formatCurrentDateTime(reading.measuredAt)}`}
              onPress={() => openEditor({ reading, measuredAt: reading.measuredAt })}
              trailing={<Icon name="chevron-right" size="sm" color={uiRoles.inkFaint} />}>
              <Stat label={`${reading.weightUnit} · ${formatCurrentDateTime(reading.measuredAt)}`} value={reading.weightValue}
                rank="secondary" />
              {!isValidBodyWeightReading(reading) ? <Text allowFontScaling={false} style={styles.body}>Needs review</Text> : null}
            </ListRow>)}</Card>}
          </View>
        </>}
    </ScreenScroll>
    <SessionWeightBackfillSheet visible={backfillVisible} onDismiss={() => setBackfillVisible(false)}
      onAfterDismiss={finishBackfillDismissal}
      onAddReading={() => {
        readingAfterBackfill.current = true;
        setBackfillVisible(false);
      }} />
    {editor ? <WeightEntrySheet visible={editorVisible} title={editor.reading ? 'Edit reading' : 'Add reading'}
      autoFocus={!editor.reading}
      initial={editor.reading ?? { weightValue: '', weightUnit: current?.weightUnit ?? 'kg' }} measuredAt={editor.measuredAt}
      explanation="This reading will be available to new sessions. Saved session weights stay unchanged."
      onDismiss={() => setEditorVisible(false)}
      onSave={async input => {
        if (!input.measuredAt) throw new Error('Enter a measurement date.');
        await saveBodyWeightReading({ ...input, measuredAt: input.measuredAt, id: editor.reading?.id });
        setFeedback('Reading saved. Existing sessions are unchanged.');
        await load();
      }} onDelete={editor.reading ? async () => {
        await deleteBodyWeightReading(editor.reading!.id);
        setFeedback('Reading deleted. Existing sessions are unchanged.');
        await load();
      } : undefined} /> : null}
  </>;
}
