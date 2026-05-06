'use client';
import { Field } from '@/components/shared';
import { SearchableSelect, SelectOption } from '@/components/searchable-select';

export interface OwnerFormDraft {
  displayName: string;
  email: string;
  accountStatus: string;
  gymIds: string[];
}

export const BLANK_OWNER_DRAFT: OwnerFormDraft = {
  displayName: '',
  email: '',
  accountStatus: 'active',
  gymIds: [],
};

interface OwnerInlineFormProps {
  draft: OwnerFormDraft;
  onChange: (draft: OwnerFormDraft) => void;
  errors: Record<string, string>;
  onClearError: (key: string) => void;
  /** Hide the gyms multi-select (used when creating from Gym page to avoid cycle) */
  hideGymSelect?: boolean;
  /** Gym options for the select */
  gymOptions?: SelectOption[];
  /** Callback to open gym creation */
  onCreateGym?: () => void;
}

export function OwnerInlineForm({
  draft,
  onChange,
  errors,
  onClearError,
  hideGymSelect = false,
  gymOptions = [],
  onCreateGym,
}: OwnerInlineFormProps) {
  return (
    <div className="space-y-4">
      <Field label="Display name" error={errors.displayName}>
        <input
          className="ui-input"
          value={draft.displayName}
          onChange={e => { onChange({ ...draft, displayName: e.target.value }); onClearError('displayName'); }}
        />
      </Field>
      <Field label="Email" error={errors.email}>
        <input
          className="ui-input"
          type="email"
          value={draft.email}
          onChange={e => { onChange({ ...draft, email: e.target.value }); onClearError('email'); }}
        />
      </Field>
      {!hideGymSelect && (
        <Field label="Gyms" hint="Owner can manage multiple gyms." error={errors.gyms}>
          <SearchableSelect
            options={gymOptions}
            value={draft.gymIds}
            onChange={(v) => { onChange({ ...draft, gymIds: v as string[] }); onClearError('gyms'); }}
            placeholder="Search gyms..."
            multiple
            allowCreate={!!onCreateGym}
            createLabel="Create new gym"
            onCreateNew={onCreateGym}
          />
        </Field>
      )}
      <Field label="Status" error={errors.accountStatus}>
        <select
          className="ui-input"
          value={draft.accountStatus}
          onChange={e => { onChange({ ...draft, accountStatus: e.target.value }); onClearError('accountStatus'); }}
        >
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </Field>
    </div>
  );
}

export function validateOwnerDraft(draft: OwnerFormDraft, opts?: { requireGym?: boolean }): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!draft.displayName?.trim()) errs.displayName = 'Display name is required';
  if (!draft.email?.trim()) errs.email = 'Email is required';
  if (opts?.requireGym && draft.gymIds.length === 0) errs.gyms = 'At least one gym is required';
  if (!draft.accountStatus) errs.accountStatus = 'Status is required';
  return errs;
}
