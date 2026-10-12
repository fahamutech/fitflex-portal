'use client';
import { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { useApp } from '../../app/providers';
import { api, ApiError, Exercise, ExerciseInput, ExerciseOptions } from '@/lib/api';
import { Alert, Badge, Button, Card, CardContent, EmptyState, Field, PageHeader, Spinner } from '@/components/shared';
import { Dialog } from '@/components/dialog';

// The words for ids the library uses. Anything not listed is shown as its id in plain words.
const WORDS: Record<string, string> = {
  abs: 'Abs', lower_back: 'Lower back', full_body: 'Full body', cardio: 'Cardio fitness',
  none: 'No equipment', resistance_bands: 'Resistance bands', free_weights: 'Free weights', full_gym: 'Full gym', other: 'Other',
  hiit: 'HIIT', outdoor: 'Outdoors',
  lose_weight: 'Lose weight', gain_muscle: 'Gain muscle', build_muscle: 'Build muscle', stay_fit: 'Stay fit',
  improve_endurance: 'Improve endurance', improve_flexibility: 'Improve flexibility', learn_new_skill: 'Learn a new skill', stress_relief: 'Stress relief',
  upper_body: 'Upper body', lower_body: 'Lower body', core: 'Core', general: 'General',
};
const word = (id: string) => WORDS[id] ?? id.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

const FIELD_ERRORS: Record<string, string> = {
  name: 'Give the exercise a name (up to 80 characters).',
  category: 'Choose what kind of exercise it is.',
  targetAreas: 'Choose at least one area it mainly works.',
  secondaryAreas: 'One of the supporting areas isn’t valid.',
  difficulty: 'Choose the lowest level it suits.',
  equipment: 'Choose what is needed — “No equipment” for bodyweight.',
  environment: 'Choose at least one place it can be done.',
  suitableGoals: 'Choose at least one goal it serves.',
  defaultSets: 'Sets must be a whole number of 1 or more.',
  defaultReps_or_defaultDuration: 'Enter the reps, or the seconds, as a whole number of 1 or more.',
  restSeconds: 'Rest must be a whole number of seconds, 0 or more.',
  instructions: 'Write 1 to 8 short steps, one per line.',
  alternatives: 'Choose up to 6 alternatives, none of them the exercise itself.',
};
const ERRORS: Record<string, string> = {
  last_active_exercise: 'This is the only exercise switched on, so it can’t be switched off.',
  not_edited: 'This exercise is already as FitFlex shipped it.',
  not_found: 'That exercise no longer exists. Refresh and try again.',
  acl_forbidden: 'You don’t have permission to manage exercises.',
};
const message = (e: unknown) => {
  if (!(e instanceof ApiError)) return 'That didn’t work. Please try again.';
  const body = e.body as { error?: string; field?: string } | null;
  if (body?.error === 'invalid_exercise') return FIELD_ERRORS[body.field ?? ''] ?? 'Something in the form isn’t valid.';
  return ERRORS[body?.error ?? ''] ?? 'That didn’t work. Please try again.';
};

const SOURCE: Record<Exercise['source'], { label: string; tone: 'gray' | 'brand' | 'warning' }> = {
  builtin: { label: 'Built in', tone: 'gray' },
  edited: { label: 'Edited', tone: 'warning' },
  custom: { label: 'Added by FitFlex', tone: 'brand' },
};
const prescription = (e: Exercise) =>
  `${e.defaultSets} × ${e.defaultReps ? e.defaultReps : `${e.defaultDuration ?? 0} s`}`;

export function ExerciseManager() {
  const { token } = useApp();
  const [rows, setRows] = useState<Exercise[] | null>(null);
  const [options, setOptions] = useState<ExerciseOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [area, setArea] = useState('');
  const [status, setStatus] = useState<'all' | 'on' | 'off'>('all');
  const [editing, setEditing] = useState<Exercise | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    if (!token) return;
    setError(null);
    try {
      const r = await api.adminExercises(token);
      setRows(r.exercises);
      setOptions(r.options);
    } catch (e) {
      setError(message(e));
      setRows(prev => prev ?? []);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token]);

  const shown = useMemo(() => (rows ?? []).filter(e =>
    (!search || `${e.name} ${e.description ?? ''}`.toLowerCase().includes(search.toLowerCase()))
    && (!area || e.targetAreas.includes(area))
    && (status === 'all' || (status === 'on') === e.active)), [rows, search, area, status]);

  const toggle = async (e: Exercise) => {
    if (!token) return;
    if (e.active && !window.confirm(`Switch off “${e.name}”? It won’t be chosen for new plans. Workouts already planned keep it.`)) return;
    setBusyId(e.id);
    setError(null);
    try {
      await api.updateExercise(token, e.id, { active: !e.active });
      await load();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusyId(null);
    }
  };

  const on = (rows ?? []).filter(e => e.active).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exercises"
        description="The exercises FitFlex builds members’ training plans from. Add your own, edit any of them, add Swahili, or switch one off. Changes reach new plans within a minute; workouts already planned are not changed."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4" />Refresh</Button>
            <Button size="sm" onClick={() => setEditing('new')} data-testid="exercise-new"><Plus className="h-4 w-4" />New exercise</Button>
          </>
        }
      />
      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Field label="Search">
            <input className="ui-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or description" data-testid="exercise-search" />
          </Field>
        </div>
        <Field label="Area">
          <select className="ui-input" value={area} onChange={e => setArea(e.target.value)} data-testid="exercise-area-filter">
            <option value="">All areas</option>
            {(options?.targetAreaGroups ?? []).map(g => (
              <optgroup key={g.id} label={word(g.id)}>
                {g.areas.map(a => <option key={a} value={a}>{word(a)}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select className="ui-input" value={status} onChange={e => setStatus(e.target.value as 'all' | 'on' | 'off')} data-testid="exercise-status-filter">
            <option value="all">On and off</option>
            <option value="on">Switched on</option>
            <option value="off">Switched off</option>
          </select>
        </Field>
      </div>

      {rows === null ? (
        <div className="flex h-40 items-center justify-center"><Spinner className="h-6 w-6" /></div>
      ) : (
        <>
          <p className="text-sm text-[var(--color-fg-tertiary)]" data-testid="exercise-count">
            {shown.length} of {rows.length} shown · {on} switched on
          </p>
          {shown.length === 0 ? (
            <EmptyState title="No exercises match" body="Change the search or the filters, or add a new exercise." />
          ) : (
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm" data-testid="exercise-table">
                  <thead className="border-b border-[var(--color-border-secondary)] text-left text-xs text-[var(--color-fg-tertiary)]">
                    <tr>
                      <th className="px-4 py-3 font-medium">Exercise</th>
                      <th className="px-4 py-3 font-medium">Works</th>
                      <th className="px-4 py-3 font-medium">Needs</th>
                      <th className="px-4 py-3 font-medium">Level</th>
                      <th className="px-4 py-3 font-medium">Sets</th>
                      <th className="px-4 py-3 font-medium">Swahili</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(e => (
                      <tr key={e.id} className="border-b border-[var(--color-border-secondary)] last:border-0" data-testid={`exercise-row-${e.id}`}>
                        <td className="px-4 py-3">
                          <button className="text-left font-medium text-[var(--color-fg-primary)] underline-offset-2 hover:underline" onClick={() => setEditing(e)} data-testid={`exercise-open-${e.id}`}>{e.name}</button>
                          <div className="mt-1"><Badge tone={SOURCE[e.source].tone}>{SOURCE[e.source].label}</Badge></div>
                        </td>
                        <td className="px-4 py-3">{e.targetAreas.map(word).join(', ')}</td>
                        <td className="px-4 py-3">{e.equipment.map(word).join(', ')}</td>
                        <td className="px-4 py-3">{word(e.difficulty)}</td>
                        <td className="px-4 py-3 tabular-nums">{prescription(e)}</td>
                        <td className="px-4 py-3">{e.i18n?.sw?.name || e.i18n?.sw?.instructions?.length ? 'Yes' : '—'}</td>
                        <td className="px-4 py-3"><Badge tone={e.active ? 'success' : 'gray'} dot>{e.active ? 'On' : 'Off'}</Badge></td>
                        <td className="px-4 py-3 text-right">
                          <Button variant="secondary" size="sm" disabled={busyId === e.id} onClick={() => toggle(e)} data-testid={`exercise-toggle-${e.id}`}>
                            {e.active ? 'Switch off' : 'Switch on'}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {editing && options && (
        <ExerciseForm
          options={options}
          all={rows ?? []}
          existing={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}
    </div>
  );
}

// ── Add / edit ────────────────────────────────────────────────────────────

const lines = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean);

function Choices({ label, hint, all, value, onChange, testid }: {
  label: string; hint?: string; all: string[]; value: string[]; onChange: (v: string[]) => void; testid: string;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{label}</legend>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {all.map(id => (
          <label key={id} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox" checked={value.includes(id)} data-testid={`${testid}-${id}`}
              onChange={e => onChange(e.target.checked ? [...value, id] : value.filter(x => x !== id))}
            />
            {word(id)}
          </label>
        ))}
      </div>
      {hint && <p className="mt-1 text-xs text-[var(--color-fg-quaternary)]">{hint}</p>}
    </fieldset>
  );
}

function ExerciseForm({ options, all, existing, onClose, onSaved }: {
  options: ExerciseOptions; all: Exercise[]; existing: Exercise | null; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const { token } = useApp();
  const areas = options.targetAreaGroups.flatMap(g => g.areas);
  const [f, setF] = useState(() => ({
    name: existing?.name ?? '',
    description: existing?.description ?? '',
    category: existing?.category ?? options.categories[0],
    targetAreas: existing?.targetAreas ?? [] as string[],
    secondaryAreas: existing?.secondaryAreas ?? [] as string[],
    movementPattern: existing?.movementPattern ?? '',
    difficulty: existing?.difficulty ?? options.difficulties[0],
    equipment: existing?.equipment ?? ['none'],
    environment: existing?.environment ?? [...options.environments],
    suitableGoals: existing?.suitableGoals ?? [] as string[],
    defaultSets: String(existing?.defaultSets ?? 3),
    timed: !!existing?.defaultDuration,
    amount: String(existing?.defaultDuration ?? existing?.defaultReps ?? 10),
    restSeconds: String(existing?.restSeconds ?? 60),
    tracksWeight: existing?.tracksWeight ?? false,
    instructions: (existing?.instructions ?? []).join('\n'),
    alternatives: existing?.alternatives ?? [] as string[],
    active: existing?.active ?? true,
    swName: existing?.i18n?.sw?.name ?? '',
    swDescription: existing?.i18n?.sw?.description ?? '',
    swInstructions: (existing?.i18n?.sw?.instructions ?? []).join('\n'),
  }));
  const [altSearch, setAltSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(prev => ({ ...prev, [k]: v }));

  // Alternatives: other exercises, the ones sharing a main area first.
  const candidates = useMemo(() => all
    .filter(e => e.id !== existing?.id)
    .filter(e => !altSearch || e.name.toLowerCase().includes(altSearch.toLowerCase()))
    .sort((a, b) => Number(b.targetAreas.some(x => f.targetAreas.includes(x))) - Number(a.targetAreas.some(x => f.targetAreas.includes(x))) || a.name.localeCompare(b.name)),
  [all, existing?.id, altSearch, f.targetAreas]);

  const body = (): ExerciseInput => ({
    name: f.name.trim(), description: f.description.trim(), category: f.category,
    targetAreas: f.targetAreas, secondaryAreas: f.secondaryAreas.filter(a => !f.targetAreas.includes(a)),
    movementPattern: f.movementPattern || null, difficulty: f.difficulty,
    equipment: f.equipment, environment: f.environment, suitableGoals: f.suitableGoals,
    defaultSets: Number(f.defaultSets),
    defaultReps: f.timed ? null : Number(f.amount),
    defaultDuration: f.timed ? Number(f.amount) : null,
    restSeconds: Number(f.restSeconds), tracksWeight: f.tracksWeight,
    instructions: lines(f.instructions), alternatives: f.alternatives, active: f.active,
    i18n: { sw: { name: f.swName.trim(), description: f.swDescription.trim(), instructions: lines(f.swInstructions) } },
  });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      if (existing) await api.updateExercise(token, existing.id, body());
      else await api.createExercise(token, body());
      await onSaved();
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!token || !existing) return;
    if (!window.confirm(`Put “${existing.name}” back to how FitFlex shipped it? Your changes to it, including Swahili, are removed.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.resetExercise(token, existing.id);
      await onSaved();
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };

  // "No equipment" stands alone.
  const setEquipment = (next: string[]) => {
    const added = next.find(x => !f.equipment.includes(x));
    set('equipment', added === 'none' ? ['none'] : next.filter(x => x !== 'none').length ? next.filter(x => x !== 'none') : ['none']);
  };

  return (
    <Dialog open onClose={onClose} title={existing ? `Edit ${existing.name}` : 'New exercise'} size="xl"
      description={existing?.source === 'builtin' ? 'This is a built-in exercise. Saving keeps your version; you can put it back later.' : undefined}>
      <form onSubmit={save} className="space-y-5" data-testid="exercise-form">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input className="ui-input" value={f.name} onChange={e => set('name', e.target.value)} maxLength={80} required data-testid="exercise-name" />
          </Field>
          <Field label="Kind">
            <select className="ui-input" value={f.category} onChange={e => set('category', e.target.value)} data-testid="exercise-category">
              {options.categories.map(c => <option key={c} value={c}>{word(c)}</option>)}
            </select>
          </Field>
        </div>
        <Field label="One line on what it is">
          <input className="ui-input" value={f.description} onChange={e => set('description', e.target.value)} maxLength={240} data-testid="exercise-description" />
        </Field>

        <Choices label="Mainly works" hint="A replacement offered to a member always shares one of these." all={areas} value={f.targetAreas} onChange={v => set('targetAreas', v)} testid="exercise-target" />
        <Choices label="Also works (optional)" all={areas.filter(a => !f.targetAreas.includes(a))} value={f.secondaryAreas} onChange={v => set('secondaryAreas', v)} testid="exercise-secondary" />
        <Choices label="Needs" hint="A member only gets it if they have everything ticked." all={options.equipment} value={f.equipment} onChange={setEquipment} testid="exercise-equipment" />
        <Choices label="Can be done" all={options.environments} value={f.environment} onChange={v => set('environment', v)} testid="exercise-environment" />
        <Choices label="Serves these goals" all={options.goals} value={f.suitableGoals} onChange={v => set('suitableGoals', v)} testid="exercise-goal" />

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Lowest level it suits">
            <select className="ui-input" value={f.difficulty} onChange={e => set('difficulty', e.target.value)} data-testid="exercise-difficulty">
              {options.difficulties.map(d => <option key={d} value={d}>{word(d)}</option>)}
            </select>
          </Field>
          <Field label="Movement (optional)">
            <select className="ui-input" value={f.movementPattern} onChange={e => set('movementPattern', e.target.value)}>
              <option value="">Not set</option>
              {options.movementPatterns.map(m => <option key={m} value={m}>{word(m)}</option>)}
            </select>
          </Field>
          <Field label="Rest between sets (seconds)">
            <input className="ui-input" type="number" min={0} value={f.restSeconds} onChange={e => set('restSeconds', e.target.value)} data-testid="exercise-rest" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Sets">
            <input className="ui-input" type="number" min={1} value={f.defaultSets} onChange={e => set('defaultSets', e.target.value)} data-testid="exercise-sets" />
          </Field>
          <Field label="Each set is">
            <select className="ui-input" value={f.timed ? 'timed' : 'reps'} onChange={e => set('timed', e.target.value === 'timed')} data-testid="exercise-measure">
              <option value="reps">Counted in reps</option>
              <option value="timed">Timed in seconds</option>
            </select>
          </Field>
          <Field label={f.timed ? 'Seconds per set' : 'Reps per set'}>
            <input className="ui-input" type="number" min={1} value={f.amount} onChange={e => set('amount', e.target.value)} data-testid="exercise-amount" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.tracksWeight} onChange={e => set('tracksWeight', e.target.checked)} data-testid="exercise-weight" />
          Members record the weight they used (kg)
        </label>

        <Field label="How to do it" hint="One short step per line, up to 8.">
          <textarea className="ui-input" rows={4} value={f.instructions} onChange={e => set('instructions', e.target.value)} data-testid="exercise-instructions" />
        </Field>

        <fieldset>
          <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">Alternatives (up to 6)</legend>
          <p className="mt-0.5 text-xs text-[var(--color-fg-quaternary)]">Offered first when a member asks to replace this exercise. Ones sharing a main area are listed first.</p>
          <input className="ui-input mt-2" value={altSearch} onChange={e => setAltSearch(e.target.value)} placeholder="Find an exercise" aria-label="Find an alternative" />
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border-secondary)] p-2">
            {candidates.map(e => (
              <label key={e.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox" checked={f.alternatives.includes(e.id)} data-testid={`exercise-alt-${e.id}`}
                  disabled={!f.alternatives.includes(e.id) && f.alternatives.length >= 6}
                  onChange={ev => set('alternatives', ev.target.checked ? [...f.alternatives, e.id] : f.alternatives.filter(x => x !== e.id))}
                />
                {e.name}<span className="text-xs text-[var(--color-fg-quaternary)]">{e.targetAreas.map(word).join(', ')}{e.active ? '' : ' · off'}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-4">
          <legend className="px-1 text-sm font-medium text-[var(--color-fg-secondary)]">Swahili (optional)</legend>
          <p className="text-xs text-[var(--color-fg-quaternary)]">Members using the app in Swahili see these in plans made after you save. Anything left empty stays in English.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name in Swahili">
              <input className="ui-input" value={f.swName} onChange={e => set('swName', e.target.value)} maxLength={80} data-testid="exercise-sw-name" />
            </Field>
            <Field label="One line in Swahili">
              <input className="ui-input" value={f.swDescription} onChange={e => set('swDescription', e.target.value)} maxLength={240} />
            </Field>
          </div>
          <Field label="How to do it, in Swahili" hint="One step per line.">
            <textarea className="ui-input" rows={3} value={f.swInstructions} onChange={e => set('swInstructions', e.target.value)} data-testid="exercise-sw-instructions" />
          </Field>
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.active} onChange={e => set('active', e.target.checked)} data-testid="exercise-active" />
          Switched on — can be chosen for new plans
        </label>

        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-4">
          {existing?.source === 'edited' && (
            <Button type="button" variant="secondary" disabled={busy} onClick={reset} data-testid="exercise-reset">Put back to built-in</Button>
          )}
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy} data-testid="exercise-save">{existing ? 'Save changes' : 'Add exercise'}</Button>
        </div>
      </form>
    </Dialog>
  );
}
