import { ChipGroup } from '@/components/ui';
import { buildStreamFilterChips, type GroupSummary } from '@/src/groups';

type GroupFilterChipsProps = {
  groups: Pick<GroupSummary, 'group_id' | 'name'>[];
  selectedGroupId: string | null;
  onChange: (groupId: string) => void;
};

/**
 * One chip per group; exactly one is selected. Chips wrap onto more lines
 * rather than scrolling sideways (08 baseline: no horizontal scrolling).
 * testIDs: `groups-stream-filter-<groupId>`.
 */
export function GroupFilterChips({ groups, selectedGroupId, onChange }: GroupFilterChipsProps) {
  const chips = buildStreamFilterChips(groups, selectedGroupId);
  const selectedKey = chips.find((chip) => chip.selected)?.key ?? '';

  return (
    <ChipGroup
      accessibilityLabel="Choose a group"
      mode="single"
      onChange={onChange}
      options={chips.map((chip) => ({ value: chip.key, label: chip.label }))}
      testIDPrefix="groups-stream-filter"
      value={selectedKey}
    />
  );
}
