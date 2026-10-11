import { Sheet } from '@/components/ui/sheet';
import { SwitchRow } from '@/components/ui/switch-row';
import {
  STREAM_EVENT_KIND_LABELS,
  STREAM_EVENT_KINDS,
  type StreamEventKind,
} from '@/src/groups/competition-stream-view-model';

export type GroupStreamEventsSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  hiddenKinds: readonly StreamEventKind[];
  onChange: (next: StreamEventKind[]) => void;
};

/**
 * Developer drawer: which competition event kinds the stream draws. Links are
 * off by default; this turns them, and anything else switched off, back on
 * for a look at the raw stream. Developer builds only (`isDevMode`).
 */
export function GroupStreamEventsSheet({ visible, onDismiss, hiddenKinds, onChange }: GroupStreamEventsSheetProps) {
  const toggle = (kind: StreamEventKind, shown: boolean) =>
    onChange(shown ? hiddenKinds.filter((entry) => entry !== kind) : [...hiddenKinds, kind]);
  return (
    <Sheet
      dismissLabel="Dismiss event types"
      onDismiss={onDismiss}
      testID="groups-stream-events-sheet"
      title="Event types"
      visible={visible}>
      {STREAM_EVENT_KINDS.map((kind) => (
        <SwitchRow
          key={kind}
          label={STREAM_EVENT_KIND_LABELS[kind]}
          onValueChange={(shown) => toggle(kind, shown)}
          testID={`groups-stream-events-${kind}`}
          value={!hiddenKinds.includes(kind)}
        />
      ))}
    </Sheet>
  );
}
