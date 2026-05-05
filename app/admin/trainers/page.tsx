'use client';
import { useEffect, useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, RefreshCw, X } from 'lucide-react';
import { useApp } from '../../providers';
import { api, Gym, TrainerProfile } from '@/lib/api';
import { Badge, Button, PageHeader, Alert, Spinner, Card, Field } from '@/components/shared';
import { DataTable, ColumnDef } from '@/components/data-table';
import { Dialog, DialogFooter, ConfirmDialog } from '@/components/dialog';
import { SearchableSelect, SelectOption } from '@/components/searchable-select';
import { statusTone, statusLabel, money } from '@/lib/admin-utils';

export default function TrainersPage() {
  const { token, user } = useApp();
  const [trainers, setTrainers] = useState<TrainerProfile[]>([]);
  const [gyms, setGyms]         = useState<Gym[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [busy, setBusy]         = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing]   = useState<TrainerProfile | null>(null);
  const [draft, setDraft]       = useState<Partial<TrainerProfile>>({});
  const [draftGymIds, setDraftGymIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<TrainerProfile | null>(null);
  const [gymDialogOpen, setGymDialogOpen] = useState(false);
  const [newGym, setNewGym]     = useState({ name: '', location: '', tier: 'standard' });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [gymFormErrors, setGymFormErrors] = useState<Record<string, string>>({});
  const [filterGymId, setFilterGymId] = useState<string | null>(null);
  const [draftAvailability, setDraftAvailability] = useState<{ day: string; gymId: string; slots: string[] }[]>([]);

  const DAYS_OF_WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const TIME_SLOTS = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [t, g] = await Promise.all([api.adminTrainers(token), api.adminGyms(token)]);
      setTrainers(t); setGyms(g);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token]);

  const gymOptions: SelectOption[] = useMemo(() =>
    gyms.map(g => ({ value: g.id, label: g.name, sub: g.location })),
    [gyms]
  );

  function openCreate() {
    setEditing(null);
    setDraft({ displayName: '', specialties: [], hourlyRateTzs: 0, status: 'active', gymIds: [] });
    setDraftGymIds([]);
    setDraftAvailability([]);
    setFormErrors({});
    setDialogOpen(true);
  }

  function openEdit(trainer: TrainerProfile) {
    setEditing(trainer);
    setDraft({ ...trainer });
    setDraftGymIds(trainer.gymIds || []);
    setDraftAvailability(
      (trainer.availability as { day?: string; date?: string; gymId?: string; slots?: string[] }[] || []).map(a => ({
        day: a.day || a.date || 'monday',
        gymId: a.gymId || '',
        slots: a.slots || [],
      }))
    );
    setFormErrors({});
    setDialogOpen(true);
  }

  function validateTrainerForm(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!draft.displayName?.trim()) errs.displayName = 'Display name is required';
    if (!draft.email?.trim()) errs.email = 'Email is required';
    if (!draft.specialties || draft.specialties.length === 0) errs.specialties = 'At least one specialty is required';
    if (draft.hourlyRateTzs == null || draft.hourlyRateTzs <= 0) errs.hourlyRateTzs = 'Hourly rate is required';
    if (draftGymIds.length === 0) errs.gyms = 'At least one gym is required';
    if (!draft.status) errs.status = 'Status is required';
    return errs;
  }

  function validateGymForm(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!newGym.name?.trim()) errs.name = 'Gym name is required';
    return errs;
  }

  async function handleSave() {
    if (!token) return;
    const errs = validateTrainerForm();
    if (Object.keys(errs).length > 0) { setFormErrors(errs); return; }
    setFormErrors({});
    setBusy(true);
    try {
      const payload = { ...draft, gymIds: draftGymIds, availability: draftAvailability.filter(a => a.slots.length > 0) };
      if (editing) {
        await api.saveTrainer(token, { ...payload, id: editing.id });
      } else {
        await api.saveTrainer(token, payload);
      }
      setDialogOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!token || !deleteTarget) return;
    setBusy(true);
    try {
      await api.deleteTrainer(token, deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleStatusChange(trainer: TrainerProfile, newStatus: 'active' | 'suspended') {
    if (!token) return;
    try {
      await api.saveTrainer(token, { id: trainer.id, status: newStatus });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Status update failed');
    }
  }

  async function handleCreateGym() {
    if (!token) return;
    const errs = validateGymForm();
    if (Object.keys(errs).length > 0) { setGymFormErrors(errs); return; }
    setGymFormErrors({});
    setBusy(true);
    try {
      const created = await api.saveGym(token, {
        name: newGym.name,
        location: newGym.location,
        tier: newGym.tier,
        perVisitRate: 5000,
        commissionRate: 12,
        status: 'active',
        venueType: 'physical',
        accessMode: 'paid_visit',
      });
      setGyms(prev => [...prev, created]);
      setDraftGymIds(prev => [...prev, created.id]);
      setGymDialogOpen(false);
      setNewGym({ name: '', location: '', tier: 'standard' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create gym');
    } finally {
      setBusy(false);
    }
  }

  if (!token || user?.userType !== 'admin') return null;

  const gymName = (id?: string | null) => gyms.find(g => g.id === id)?.name || id || '—';

  const displayedTrainers = filterGymId
    ? trainers.filter(t => t.gymIds.includes(filterGymId))
    : trainers;

  const columns: ColumnDef<TrainerProfile>[] = [
    {
      key: 'displayName', header: 'Trainer', sortable: true,
      cell: (t) => (
        <div>
          <div className="font-medium text-[var(--color-fg-primary)]">{t.displayName || t.email || t.id}</div>
          <div className="text-xs text-[var(--color-fg-quaternary)]">{t.email || t.id}</div>
        </div>
      ),
    },
    { key: 'specialties', header: 'Specialties', cell: (t) => <span className="text-xs">{(t.specialties || []).join(', ') || '—'}</span> },
    { key: 'hourlyRateTzs', header: 'Rate', sortable: true, align: 'right', cell: (t) => <span className="tabular-nums">{money(t.hourlyRateTzs)}</span> },
    {
      key: 'gymIds', header: 'Gym', sortable: false,
      cell: (t) => (
        <div className="flex flex-wrap gap-1">
          {t.gymIds.map(id => (
            <button
              key={id}
              onClick={(e) => { e.stopPropagation(); setFilterGymId(id); }}
              className="text-xs text-[var(--color-brand-700)] hover:underline inline-flex items-center gap-0.5"
            >
              {gymName(id)}
            </button>
          ))}
          {t.gymIds.length === 0 && <span className="text-xs text-[var(--color-fg-quaternary)]">—</span>}
        </div>
      ),
    },
    {
      key: 'status', header: 'Status', sortable: true,
      cell: (t) => (
        <select
          value={t.status}
          onChange={(e) => handleStatusChange(t, e.target.value as 'active' | 'suspended')}
          className="appearance-none bg-transparent border-none text-xs font-medium cursor-pointer focus:outline-none"
          style={{ color: t.status === 'active' ? 'var(--color-success-700)' : 'var(--color-error-700)' }}
        >
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trainers"
        description={`${trainers.length} trainers registered.`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="primary" size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add trainer
            </Button>
          </div>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      {loading && !trainers.length ? (
        <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8" /></div>
      ) : (
        <Card>
          <div className="p-5">
            <DataTable
              columns={columns}
              data={displayedTrainers}
              keyFn={(t) => t.id}
              filterPlaceholder="Search trainers..."
              emptyState="No trainers found."
              extraFilters={
                filterGymId ? (
                  <button
                    onClick={() => setFilterGymId(null)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-[var(--radius-full)] font-medium bg-[var(--color-brand-50)] text-[var(--color-brand-700)] border border-[var(--color-brand-200)]"
                  >
                    Gym: {gymName(filterGymId)}
                    <X className="h-3 w-3" />
                  </button>
                ) : undefined
              }
              onRowClick={(trainer) => openEdit(trainer)}
              actions={(trainer) => (
                <>
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openEdit(trainer); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setDeleteTarget(trainer); }}>
                    <Trash2 className="h-3.5 w-3.5 text-[var(--color-error-600)]" />
                  </Button>
                </>
              )}
            />
          </div>
        </Card>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? 'Edit trainer' : 'Add trainer'} description={editing ? `Editing ${editing.displayName || editing.email}` : 'Register a new trainer.'} size="md">
        <div className="space-y-4">
          <Field label="Display name" error={formErrors.displayName}>
            <input className="ui-input" value={draft.displayName || ''} onChange={e => { setDraft({ ...draft, displayName: e.target.value }); setFormErrors(prev => { const { displayName, ...rest } = prev; return rest; }); }} />
          </Field>
          <Field label="Email" error={formErrors.email}>
            <input className="ui-input" type="email" value={draft.email || ''} onChange={e => { setDraft({ ...draft, email: e.target.value }); setFormErrors(prev => { const { email, ...rest } = prev; return rest; }); }} />
          </Field>
          <Field label="Specialties (comma-separated)" error={formErrors.specialties}>
            <input className="ui-input" value={(draft.specialties || []).join(', ')} onChange={e => { setDraft({ ...draft, specialties: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }); setFormErrors(prev => { const { specialties, ...rest } = prev; return rest; }); }} />
          </Field>
          <Field label="Hourly rate (TZS)" error={formErrors.hourlyRateTzs}>
            <input className="ui-input" type="number" value={draft.hourlyRateTzs || 0} onChange={e => { setDraft({ ...draft, hourlyRateTzs: Number(e.target.value) }); setFormErrors(prev => { const { hourlyRateTzs, ...rest } = prev; return rest; }); }} />
          </Field>
          <Field label="Gyms" hint="Select one or more gyms for this trainer." error={formErrors.gyms}>
            <SearchableSelect
              options={gymOptions}
              value={draftGymIds}
              onChange={(v) => { setDraftGymIds(v as string[]); setFormErrors(prev => { const { gyms, ...rest } = prev; return rest; }); }}
              placeholder="Search gyms..."
              multiple
              allowCreate
              createLabel="Create new gym"
              onCreateNew={() => setGymDialogOpen(true)}
            />
          </Field>
          <Field label="Availability" hint="Set available days, gym, and time slots.">
            <div className="space-y-3">
              {draftAvailability.map((entry, i) => (
                <div key={i} className="p-3 rounded-xl border border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)] space-y-2">
                  <div className="flex gap-2 items-center">
                    <select
                      className="ui-input flex-1"
                      value={entry.day}
                      onChange={e => {
                        const next = [...draftAvailability];
                        next[i] = { ...next[i], day: e.target.value };
                        setDraftAvailability(next);
                      }}
                    >
                      {DAYS_OF_WEEK.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                    </select>
                    <select
                      className="ui-input flex-1"
                      value={entry.gymId}
                      onChange={e => {
                        const next = [...draftAvailability];
                        next[i] = { ...next[i], gymId: e.target.value };
                        setDraftAvailability(next);
                      }}
                    >
                      <option value="">Any gym</option>
                      {gyms.filter(g => draftGymIds.includes(g.id)).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => setDraftAvailability(prev => prev.filter((_, j) => j !== i))}
                      className="text-[var(--color-error-600)] hover:text-[var(--color-error-700)] p-1"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {TIME_SLOTS.map(slot => {
                      const active = entry.slots.includes(slot);
                      return (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => {
                            const next = [...draftAvailability];
                            next[i] = { ...next[i], slots: active ? entry.slots.filter(s => s !== slot) : [...entry.slots, slot].sort() };
                            setDraftAvailability(next);
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
              <Button variant="secondary" size="sm" onClick={() => setDraftAvailability(prev => [...prev, { day: 'monday', gymId: '', slots: [] }])}>
                <Plus className="h-3.5 w-3.5" /> Add slot
              </Button>
            </div>
          </Field>
          <Field label="Status" error={formErrors.status}>
            <select className="ui-input" value={draft.status || 'active'} onChange={e => { setDraft({ ...draft, status: e.target.value as 'active' | 'suspended' }); setFormErrors(prev => { const { status, ...rest } = prev; return rest; }); }}>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setDialogOpen(false)} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="md" onClick={handleSave} disabled={busy}>{busy ? 'Saving...' : editing ? 'Update' : 'Create'}</Button>
        </DialogFooter>
      </Dialog>

      {/* Create Gym Inline Dialog */}
      <Dialog open={gymDialogOpen} onClose={() => setGymDialogOpen(false)} title="Create new gym" description="Quickly create a gym to assign to this trainer." size="sm">
        <div className="space-y-4">
          <Field label="Gym name" error={gymFormErrors.name}>
            <input className="ui-input" value={newGym.name} onChange={e => { setNewGym({ ...newGym, name: e.target.value }); setGymFormErrors(prev => { const { name, ...rest } = prev; return rest; }); }} />
          </Field>
          <Field label="Location">
            <input className="ui-input" value={newGym.location} onChange={e => setNewGym({ ...newGym, location: e.target.value })} />
          </Field>
          <Field label="Tier">
            <select className="ui-input" value={newGym.tier} onChange={e => setNewGym({ ...newGym, tier: e.target.value })}>
              {['standard', 'midtier', 'premium', 'luxury_executive'].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setGymDialogOpen(false)} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="md" onClick={handleCreateGym} disabled={busy}>
            {busy ? 'Creating...' : 'Create gym'}
          </Button>
        </DialogFooter>
      </Dialog>

      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title="Delete trainer" description={`Remove "${deleteTarget?.displayName || deleteTarget?.email}"? This cannot be undone.`} confirmLabel="Delete" tone="danger" busy={busy} />
    </div>
  );
}
