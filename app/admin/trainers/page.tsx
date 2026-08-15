'use client';
import { useEffect, useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, RefreshCw, X } from 'lucide-react';
import { useApp } from '../../providers';
import { api, Gym, GymOwner, TrainerProfile } from '@/lib/api';
import { Badge, Button, PageHeader, Alert, Spinner, Card, Field } from '@/components/shared';
import { DataTable, ColumnDef } from '@/components/data-table';
import { Dialog, DialogFooter, ConfirmDialog } from '@/components/dialog';
import { ImageUpload } from '@/components/image-upload';
import { SearchableSelect, SelectOption } from '@/components/searchable-select';
import { statusTone, statusLabel, money } from '@/lib/admin-utils';
import { GymCreateForm, GymDraft, BLANK_GYM_DRAFT, validateGymDraft } from '@/components/gym-create-form';
import { OwnerInlineForm, OwnerFormDraft, BLANK_OWNER_DRAFT, validateOwnerDraft } from '@/components/owner-inline-form';

export default function TrainersPage() {
  const { token, user } = useApp();
  const [trainers, setTrainers] = useState<TrainerProfile[]>([]);
  const [gyms, setGyms]         = useState<Gym[]>([]);
  const [owners, setOwners]     = useState<GymOwner[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [busy, setBusy]         = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing]   = useState<TrainerProfile | null>(null);
  const [draft, setDraft]       = useState<Partial<TrainerProfile>>({});
  const [draftGymIds, setDraftGymIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<TrainerProfile | null>(null);
  const [gymDialogOpen, setGymDialogOpen] = useState(false);
  const [newGym, setNewGym]     = useState<GymDraft>({ ...BLANK_GYM_DRAFT });
  const [gymOwnerId, setGymOwnerId] = useState<string>('');
  const [ownerDialogOpen, setOwnerDialogOpen] = useState(false);
  const [newOwner, setNewOwner] = useState<OwnerFormDraft>({ ...BLANK_OWNER_DRAFT });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [gymFormErrors, setGymFormErrors] = useState<Record<string, string>>({});
  const [ownerFormErrors, setOwnerFormErrors] = useState<Record<string, string>>({});
  const [filterGymId, setFilterGymId] = useState<string | null>(null);
  const [draftAvailability, setDraftAvailability] = useState<{ days: string[]; gymId: string; slots: string[] }[]>([]);
  const [specialtiesInput, setSpecialtiesInput] = useState('');
  const [rateInput, setRateInput] = useState('');
  const [sessionCurrency, setSessionCurrency] = useState<'TZS' | 'USD'>('TZS');
  const [availableSpecialties, setAvailableSpecialties] = useState<string[]>([]);

  const DAYS_OF_WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const TIME_SLOTS = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [t, g, o, specs] = await Promise.all([api.adminTrainers(token), api.adminGyms(token), api.gymOwners(token), api.adminGetSpecialties(token)]);
      setTrainers(t); setGyms(g); setOwners(o); setAvailableSpecialties(specs);
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

  const ownerOptions: SelectOption[] = useMemo(() =>
    owners.map(o => ({ value: o.id, label: o.displayName || o.email || o.id, sub: o.email || undefined })),
    [owners]
  );

  function openCreate() {
    setEditing(null);
    setDraft({ displayName: '', email: '', photoUrl: null, specialties: [], hourlyRateTzs: 0, sessionRateCurrency: 'TZS', status: 'active', gymIds: [] });
    setDraftGymIds([]);
    setDraftAvailability([]);
    setSpecialtiesInput('');
    setRateInput('');
    setSessionCurrency('TZS');
    setFormErrors({});
    setDialogOpen(true);
  }

  function openEdit(trainer: TrainerProfile) {
    setEditing(trainer);
    setDraft({ ...trainer });
    setDraftGymIds(trainer.gymIds || []);
    setDraftAvailability(
      (trainer.availability as { day?: string; days?: string[]; date?: string; gymId?: string; slots?: string[] }[] || []).map(a => ({
        days: a.days || (a.day ? [a.day] : a.date ? [a.date] : ['monday']),
        gymId: a.gymId || '',
        slots: a.slots || [],
      }))
    );
    setSpecialtiesInput((trainer.specialties || []).join(','));
    setRateInput(String(trainer.hourlyRateTzs || ''));
    setSessionCurrency((trainer.sessionRateCurrency as 'TZS' | 'USD') || 'TZS');
    setFormErrors({});
    setDialogOpen(true);
  }

  function validateTrainerForm(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!draft.displayName?.trim()) errs.displayName = 'Display name is required';
    if (!draft.email?.trim()) errs.email = 'Email is required';
    const specs = specialtiesInput.split(',').map(s => s.trim()).filter(Boolean);
    if (specs.length === 0) errs.specialties = 'At least one specialty is required';
    const rate = Number(rateInput);
    if (!rate || rate <= 0) errs.hourlyRateTzs = 'Per session rate is required';
    if (draftGymIds.length === 0) errs.gyms = 'At least one gym is required';
    if (!draft.status) errs.status = 'Status is required';
    return errs;
  }

  function toggleSpecialty(spec: string) {
    const current = specialtiesInput ? specialtiesInput.split(',').map(s => s.trim()).filter(Boolean) : [];
    const next = current.includes(spec) ? current.filter(s => s !== spec) : [...current, spec];
    setSpecialtiesInput(next.join(','));
    setFormErrors(prev => { const { specialties: _, ...rest } = prev; return rest; });
  }

  function validateGymForm(): Record<string, string> {
    return validateGymDraft(newGym);
  }

  async function handleSave() {
    if (!token) return;
    const errs = validateTrainerForm();
    setFormErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    try {
      const specialties = specialtiesInput.split(',').map(s => s.trim()).filter(Boolean);
      const hourlyRateTzs = Number(rateInput) || 0;
      // Flatten multi-day entries into individual day entries for backend
      const availability = draftAvailability
        .filter(a => a.slots.length > 0 && a.days.length > 0)
        .flatMap(a => a.days.map(day => ({ day, gymId: a.gymId || undefined, slots: a.slots })));
      const payload = { ...draft, specialties, hourlyRateTzs, sessionRateCurrency: sessionCurrency, gymIds: draftGymIds, availability };
      if (editing) {
        await api.saveTrainer(token, { ...payload, id: editing.id });
      } else {
        await api.saveTrainer(token, payload);
      }
      setDialogOpen(false);
      await load();
    } catch (e: any) {
      const msg = e?.body?.error || (e instanceof Error ? e.message : 'Save failed');
      if (e?.status === 409) {
        setFormErrors({ email: msg === 'email_already_used' ? 'This email is already in use' : msg });
      } else {
        setError(msg);
      }
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

  async function handleStatusChange(trainer: TrainerProfile, newStatus: 'active' | 'inactive' | 'suspended') {
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
        ratePerDay: newGym.ratePerDay,
        ratePerWeek: newGym.ratePerWeek,
        ratePerMonth: newGym.ratePerMonth,
        perVisitRate: newGym.ratePerDay,
        commissionRate: newGym.commissionRate,
        status: newGym.status,
        venueType: 'physical',
        accessMode: 'paid_visit',
        coordinates: newGym.coordinates.lat != null ? newGym.coordinates as any : undefined,
        images: newGym.images.length > 0 ? newGym.images : undefined,
        thumbnails: newGym.thumbnails.length > 0 ? newGym.thumbnails : undefined,
      });
      // Assign owner to the new gym if selected
      if (gymOwnerId) {
        await api.saveGymOwner(token, { id: gymOwnerId, gymId: created.id });
      }
      setGyms(prev => [...prev, created]);
      setDraftGymIds(prev => [...prev, created.id]);
      setGymDialogOpen(false);
      setNewGym({ ...BLANK_GYM_DRAFT });
      setGymOwnerId('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create gym');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateOwnerInline() {
    if (!token) return;
    const errs = validateOwnerDraft(newOwner);
    if (Object.keys(errs).length > 0) { setOwnerFormErrors(errs); return; }
    setOwnerFormErrors({});
    setBusy(true);
    try {
      const created = await api.saveGymOwner(token, { displayName: newOwner.displayName, email: newOwner.email, accountStatus: newOwner.accountStatus as 'active' | 'suspended' });
      setOwners(prev => [...prev, created]);
      setGymOwnerId(created.id);
      setOwnerDialogOpen(false);
      setNewOwner({ ...BLANK_OWNER_DRAFT });
    } catch (e: any) {
      if (e?.status === 409) {
        setOwnerFormErrors({ email: 'This email is already in use' });
      } else {
        setError(e instanceof Error ? e.message : 'Failed to create owner');
      }
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
    { key: 'hourlyRateTzs', header: 'Session Rate', sortable: true, align: 'right', cell: (t) => <span className="tabular-nums">{money(t.hourlyRateTzs, t.sessionRateCurrency || 'TZS')}</span> },
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
          onChange={(e) => handleStatusChange(t, e.target.value as 'active' | 'inactive' | 'suspended')}
          className="appearance-none bg-transparent border-none text-xs font-medium cursor-pointer focus:outline-none"
          style={{ color: t.status === 'active' ? 'var(--color-success-700)' : t.status === 'inactive' ? 'var(--color-warning-700)' : 'var(--color-error-700)' }}
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
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
          <Field label="Trainer image" hint="Upload a profile photo. PNG, JPG, or WEBP.">
            <ImageUpload
              token={token}
              value={draft.photoUrl ? [draft.photoUrl] : []}
              thumbnails={[]}
              onChange={(imgs) => setDraft({ ...draft, photoUrl: imgs[0] || null })}
              maxFiles={1}
            />
          </Field>
          <Field label="Specialties" hint="Select all that apply." error={formErrors.specialties}>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {(availableSpecialties.length > 0 ? availableSpecialties : ['Yoga','Cardio','Weight Training','Aerobics','Weight Loss','Muscle Gain','Dance','Physiotherapy','Women Only','Boxing','Pilates','CrossFit','Swimming','Nutrition','HIIT','Stretching']).map(spec => {
                const selected = specialtiesInput.split(',').map(s => s.trim()).filter(Boolean).includes(spec);
                return (
                  <button
                    key={spec}
                    type="button"
                    onClick={() => toggleSpecialty(spec)}
                    className={`px-2.5 py-1 text-xs rounded-[var(--radius-full)] font-medium border transition-colors ${
                      selected
                        ? 'bg-[var(--color-brand-600)] text-white border-[var(--color-brand-600)]'
                        : 'text-[var(--color-fg-tertiary)] border-[var(--color-border-secondary)] hover:bg-[var(--color-bg-tertiary)]'
                    }`}
                  >
                    {spec}
                  </button>
                );
              })}
            </div>
          </Field>
          <div className="flex gap-3">
            <Field label="Currency" error={undefined}>
              <select className="ui-input" value={sessionCurrency} onChange={e => setSessionCurrency(e.target.value as 'TZS' | 'USD')}>
                <option value="TZS">TZS</option>
                <option value="USD">USD</option>
              </select>
            </Field>
            <Field label="Per session rate" error={formErrors.hourlyRateTzs}>
              <input className="ui-input" type="number" value={rateInput} onChange={e => { setRateInput(e.target.value); setFormErrors(prev => { const { hourlyRateTzs, ...rest } = prev; return rest; }); }} placeholder={sessionCurrency === 'USD' ? 'e.g. 30' : 'e.g. 15000'} />
            </Field>
          </div>
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
                  <div className="flex flex-wrap gap-1 mb-1">
                    {DAYS_OF_WEEK.map(d => {
                      const active = entry.days.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => {
                            const next = [...draftAvailability];
                            next[i] = { ...next[i], days: active ? entry.days.filter(x => x !== d) : [...entry.days, d] };
                            setDraftAvailability(next);
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
              <Button variant="secondary" size="sm" onClick={() => setDraftAvailability(prev => [...prev, { days: [], gymId: '', slots: [] }])}>
                <Plus className="h-3.5 w-3.5" /> Add slot
              </Button>
            </div>
          </Field>
          <Field label="Status" error={formErrors.status}>
            <select className="ui-input" value={draft.status || 'active'} onChange={e => { setDraft({ ...draft, status: e.target.value as 'active' | 'inactive' | 'suspended' }); setFormErrors(prev => { const { status, ...rest } = prev; return rest; }); }}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </select>
          </Field>
          <label className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3 text-sm text-[var(--color-fg-primary)]">
            <input
              aria-label="Verified trainer"
              type="checkbox"
              checked={draft.verified === true}
              onChange={e => setDraft({ ...draft, verified: e.target.checked })}
            />
            Verified trainer — show the verified badge to members
          </label>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setDialogOpen(false)} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="md" onClick={handleSave} disabled={busy}>{busy ? 'Saving...' : editing ? 'Update' : 'Create'}</Button>
        </DialogFooter>
      </Dialog>

      {/* Create Gym Inline Dialog — same form as Gyms page, trainer select omitted (auto-assigned) */}
      <Dialog open={gymDialogOpen} onClose={() => setGymDialogOpen(false)} title="Create new gym" description="This gym will be automatically assigned to the trainer you are editing." size="lg">
        <GymCreateForm
          token={token}
          draft={newGym}
          onChange={setNewGym}
          errors={gymFormErrors}
          onClearError={(k) => setGymFormErrors(prev => { const { [k]: _, ...rest } = prev; return rest; })}
          extraFields={
            <Field label="Owner" hint="Select an owner for this gym (optional).">
              <SearchableSelect
                options={ownerOptions}
                value={gymOwnerId}
                onChange={(v) => setGymOwnerId(v as string)}
                placeholder="Search or select owner..."
                allowCreate
                createLabel="Create new owner"
                onCreateNew={() => setOwnerDialogOpen(true)}
              />
            </Field>
          }
        />
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setGymDialogOpen(false)} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="md" onClick={handleCreateGym} disabled={busy}>
            {busy ? 'Creating...' : 'Create gym'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Create Owner Inline — same form as Owners page, gym select omitted (auto-assigned) */}
      <Dialog open={ownerDialogOpen} onClose={() => setOwnerDialogOpen(false)} title="Create new owner" description="This owner will be assigned to the gym you are creating." size="md">
        <OwnerInlineForm
          draft={newOwner}
          onChange={setNewOwner}
          errors={ownerFormErrors}
          onClearError={(k) => setOwnerFormErrors(prev => { const { [k]: _, ...rest } = prev; return rest; })}
          hideGymSelect
        />
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setOwnerDialogOpen(false)} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="md" onClick={handleCreateOwnerInline} disabled={busy}>
            {busy ? 'Creating...' : 'Create owner'}
          </Button>
        </DialogFooter>
      </Dialog>

      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title="Delete trainer" description={`Remove "${deleteTarget?.displayName || deleteTarget?.email}"? This cannot be undone.`} confirmLabel="Delete" tone="danger" busy={busy} />
    </div>
  );
}
