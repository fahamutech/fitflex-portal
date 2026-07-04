'use client';
import { Plus, X } from 'lucide-react';
import { Field, Button } from '@/components/shared';
import { ImageUpload } from '@/components/image-upload';
import { SearchableSelect, SelectOption } from '@/components/searchable-select';
import { Gym } from '@/lib/api';

const DAYS_OF_WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const TIME_SLOTS = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];

export interface AvailabilityEntry {
  days: string[];
  gymId: string;
  slots: string[];
}

export interface TrainerFormDraft {
  displayName: string;
  email: string;
  photoUrl: string;
  specialties: string;
  hourlyRateTzs: string;
  status: string;
  gymIds: string[];
  availability: AvailabilityEntry[];
}

export const BLANK_TRAINER_DRAFT: TrainerFormDraft = {
  displayName: '',
  email: '',
  photoUrl: '',
  specialties: '',
  hourlyRateTzs: '',
  status: 'active',
  gymIds: [],
  availability: [],
};

interface TrainerInlineFormProps {
  draft: TrainerFormDraft;
  onChange: (draft: TrainerFormDraft) => void;
  errors: Record<string, string>;
  onClearError: (key: string) => void;
  /** Hide the gyms multi-select (used when creating from Gym page to avoid cycle) */
  hideGymSelect?: boolean;
  /** Gym options for the select */
  gymOptions?: SelectOption[];
  /** Gyms list (for availability gym filter) */
  gyms?: Gym[];
  /** Callback to open gym creation */
  onCreateGym?: () => void;
}

export function TrainerInlineForm({
  draft,
  onChange,
  errors,
  onClearError,
  hideGymSelect = false,
  gymOptions = [],
  gyms = [],
  onCreateGym,
}: TrainerInlineFormProps) {
  function updateAvailability(newAvail: AvailabilityEntry[]) {
    onChange({ ...draft, availability: newAvail });
  }

  const selectedGyms = gyms.filter(g => draft.gymIds.includes(g.id));

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
      <Field label="Trainer image" hint="Upload a profile photo. PNG, JPG, or WEBP.">
        <ImageUpload
          value={draft.photoUrl ? [draft.photoUrl] : []}
          thumbnails={[]}
          onChange={(imgs) => onChange({ ...draft, photoUrl: imgs[0] || '' })}
          maxFiles={1}
        />
      </Field>
      <Field label="Specialties (comma-separated)" error={errors.specialties}>
        <input
          className="ui-input"
          value={draft.specialties}
          onChange={e => { onChange({ ...draft, specialties: e.target.value }); onClearError('specialties'); }}
          placeholder="e.g. Yoga, Weight Training, Cardio"
        />
      </Field>
      <Field label="Per session rate (TZS)" error={errors.hourlyRateTzs}>
        <input
          className="ui-input"
          type="number"
          value={draft.hourlyRateTzs}
          onChange={e => { onChange({ ...draft, hourlyRateTzs: e.target.value }); onClearError('hourlyRateTzs'); }}
          placeholder="e.g. 15000"
        />
      </Field>
      {!hideGymSelect && (
        <Field label="Gyms" hint="Select one or more gyms for this trainer." error={errors.gyms}>
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
      <Field label="Availability" hint="Set available days, gym, and time slots.">
        <div className="space-y-3">
          {draft.availability.map((entry, i) => (
            <div key={i} className="p-3 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)] space-y-2">
              <div className="flex gap-2 items-center">
                <select
                  className="ui-input flex-1"
                  value={entry.gymId}
                  onChange={e => {
                    const next = [...draft.availability];
                    next[i] = { ...next[i], gymId: e.target.value };
                    updateAvailability(next);
                  }}
                >
                  <option value="">Any gym</option>
                  {selectedGyms.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => updateAvailability(draft.availability.filter((_, j) => j !== i))}
                  className="text-[var(--color-error-600)] hover:text-[var(--color-error-700)] p-1"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1 mb-1">
                {DAYS_OF_WEEK.map(d => {
                  const active = entry.days.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        const next = [...draft.availability];
                        next[i] = { ...next[i], days: active ? entry.days.filter(x => x !== d) : [...entry.days, d] };
                        updateAvailability(next);
                      }}
                      className={`px-2.5 py-1 text-xs rounded-[var(--radius-full)] font-medium border transition-colors ${
                        active
                          ? 'bg-[var(--color-brand-600)] text-white border-[var(--color-brand-600)]'
                          : 'text-[var(--color-fg-tertiary)] border-[var(--color-border-secondary)] hover:bg-[var(--color-bg-tertiary)]'
                      }`}
                    >
                      {d.slice(0, 3).charAt(0).toUpperCase() + d.slice(1, 3)}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-1">
                {TIME_SLOTS.map(slot => {
                  const active = entry.slots.includes(slot);
                  return (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => {
                        const next = [...draft.availability];
                        next[i] = { ...next[i], slots: active ? entry.slots.filter(s => s !== slot) : [...entry.slots, slot].sort() };
                        updateAvailability(next);
                      }}
                      className={`px-2 py-0.5 text-xs rounded-[var(--radius-full)] font-medium border transition-colors ${
                        active
                          ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)] border-[var(--color-brand-200)]'
                          : 'text-[var(--color-fg-tertiary)] border-[var(--color-border-secondary)] hover:bg-[var(--color-bg-tertiary)]'
                      }`}
                    >
                      {slot}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => updateAvailability([...draft.availability, { days: [], gymId: '', slots: [] }])}>
            <Plus className="h-3.5 w-3.5" /> Add slot
          </Button>
        </div>
      </Field>
      <Field label="Status" error={errors.status}>
        <select
          className="ui-input"
          value={draft.status}
          onChange={e => { onChange({ ...draft, status: e.target.value }); onClearError('status'); }}
        >
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </Field>
    </div>
  );
}

export function validateTrainerDraft(draft: TrainerFormDraft, opts?: { requireGym?: boolean }): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!draft.displayName?.trim()) errs.displayName = 'Display name is required';
  if (!draft.email?.trim()) errs.email = 'Email is required';
  const specs = draft.specialties.split(',').map(s => s.trim()).filter(Boolean);
  if (specs.length === 0) errs.specialties = 'At least one specialty is required';
  const rate = Number(draft.hourlyRateTzs);
  if (!rate || rate <= 0) errs.hourlyRateTzs = 'Per session rate is required';
  if (opts?.requireGym && draft.gymIds.length === 0) errs.gyms = 'At least one gym is required';
  if (!draft.status) errs.status = 'Status is required';
  return errs;
}
