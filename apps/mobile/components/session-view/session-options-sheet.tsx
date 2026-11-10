import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';
import { Notice } from '@/components/ui/notice';
import type { ConnectedAgent } from '@/src/auth/connected-agents';

type SessionOptionsSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  onAbandon: () => void;
  onCompare: () => void;
  control?: {
    aiControlled: boolean; pending: boolean; busy: boolean; notice: string | null;
    choices: ConnectedAgent[] | null; onControl: () => void;
    onChoose: (agent: ConnectedAgent) => void; onManageAgents: () => void;
  };
};

// The session ⋮: Session vs history, then Abandon session.
export function SessionOptionsSheet({ visible, onDismiss, onAbandon, onCompare, control }: SessionOptionsSheetProps) {
  const choosing = control?.choices !== null && control?.choices !== undefined;
  return (
    <Sheet
      dismissLabel="Dismiss session options"
      onDismiss={onDismiss}
      testID="session-view-options-sheet"
      title={choosing ? 'Let AI log' : control?.aiControlled ? 'AI logging' : 'Session'}
      visible={visible}>
      {choosing ? control?.choices?.length ? control.choices.map(agent => (
        <ListRow key={agent.clientId} label={agent.name} onPress={() => control.onChoose(agent)}
          testID={`session-control-agent-${agent.clientId}`} />
      )) : (
        <ListRow label="Enable workout logging" onPress={control?.onManageAgents}
          testID="session-control-manage-agents" trailing={<Icon name="chevron-right" size="sm" />} />
      ) : <>
      <ListRow
        label="Session vs history"
        leading={<Icon colorRole="inkMuted" name="list" size="md" />}
        onPress={onCompare}
        testID="session-view-compare"
        trailing={<Icon colorRole="inkMuted" name="chevron-right" size="sm" />}
      />
      {control ? <ListRow
        disabled={control.busy}
        label={control.pending ? 'Retry handoff' : control.aiControlled ? 'Take over logging' : 'Let AI log this session'}
        leading={<Icon name={control.aiControlled ? 'pencil' : 'ai-logging'} size="md" />}
        onPress={control.onControl}
        testID="session-view-control-action"
      /> : null}
      <ListRow
        disabled={control?.aiControlled || control?.pending || control?.busy}
        divider
        label="Abandon session"
        leading={<Icon colorRole="danger" name="trash" size="md" />}
        onPress={onAbandon}
        testID="session-view-abandon"
        tone="danger"
        trailing={control?.aiControlled || control?.pending ? <Icon name="lock" size="sm" colorRole="inkMuted" /> : undefined}
      />
      </>}
      {control?.notice ? <Notice live message={control.notice} testID="session-control-notice" tone="danger" /> : null}
    </Sheet>
  );
}
