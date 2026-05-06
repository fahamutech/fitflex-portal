'use client';
import { useEffect, useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, RefreshCw, X } from 'lucide-react';
import { useApp } from '../../providers';
import { api, Gym, GymOwner, TrainerProfile } from '@/lib/api';
import { Badge, Button, PageHeader, Alert, Spinner, Card, Field } from '@/components/shared';
import { DataTable, ColumnDef } from '@/components/data-table';
import { Dialog, DialogFooter, ConfirmDialog } from '@/components/dialog';
import { SearchableSelect, SelectOption } from '@/components/searchable-select';
import { statusTone, statusLabel } from '@/lib/admin-utils';
import { GymCreateForm, GymDraft, BLANK_GYM_DRAFT, validateGymDraft } from '@/components/gym-create-form';
import { TrainerInlineForm, TrainerFormDraft, BLANK_TRAINER_DRAFT, validateTrainerDraft } from '@/components/trainer-inline-form';

export default function OwnersPage() {
  const { token, user } = useApp();
  const [owners, setOwners]     = useState<GymOwner[]>([]);
  const [gyms, setGyms]         = useState<Gym[]>([]);
  const [trainers, setTrainers] = useState<TrainerProfile[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [busy, setBusy]         = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing]   = useState<GymOwner | null>(null);
  const [draft, setDraft]       = useState<Partial<GymOwner>>({});
  const [draftGymIds, setDraftGymIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<GymOwner | null>(null);
  const [gymDialogOpen, setGymDialogOpen] = useState(false);
  const [newGym, setNewGym]     = useState<GymDraft>({ ...BLANK_GYM_DRAFT });
  const [gymTrainerIds, setGymTrainerIds] = useState<string[]>([]);
  const [trainerDialogOpen, setTrainerDialogOpen] = useState(false);
  const [newTrainer, setNewTrainer] = useState<TrainerFormDraft>({ ...BLANK_TRAINER_DRAFT });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [gymFormErrors, setGymFormErrors] = useState<Record<string, string>>({});
  const [trainerFormErrors, setTrainerFormErrors] = useState<Record<string, string>>({});
  const [filterGymId, setFilterGymId] = useState<string | null>(null);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [o, g, t] = await Promise.all([api.gymOwners(token), api.adminGyms(token), api.adminTrainers(token)]);
      setOwners(o); setGyms(g); setTrainers(t);
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

  const trainerOptions: SelectOption[] = useMemo(() =>
    trainers.map(t => ({ value: t.id, label: t.displayName || t.email || t.id, sub: t.email || undefined })),
    [trainers]
  );

  function openCreate() {
    setEditing(null);
    setDraft({ displayName: '', email: '', accountStatus: 'active' });
    setDraftGymIds([]);
    setFormErrors({});
    setDialogOpen(true);
  }

  function openEdit(owner: GymOwner) {
    setEditing(owner);
    setDraft({ ...owner });
    const ids = owner.gymIds || (owner.gymId ? [owner.gymId] : []);
    setDraftGymIds(ids);
    setFormErrors({});
    setDialogOpen(true);
  }

  function validateOwnerForm(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!draft.displayName?.trim()) errs.displayName = 'Display name is required';
    if (!draft.email?.trim()) errs.email = 'Email is required';
    if (draftGymIds.length === 0) errs.gyms = 'At least one gym is required';
    if (!draft.accountStatus) errs.accountStatus = 'Status is required';
    return errs;
  }

  function validateGymForm(): Record<string, string> {
    return validateGymDraft(newGym);
  }

  async function handleSave() {
    if (!token) return;
    const errs = validateOwnerForm();
    if (Object.keys(errs).length > 0) { setFormErrors(errs); return; }
    setFormErrors({});
    setBusy(true);
    try {
      const payload: Partial<GymOwner> = {
        ...draft,
        gymId: draftGymIds[0] || null,
        gymIds: draftGymIds,
      };
      if (editing) {
        await api.saveGymOwner(token, { ...payload, id: editing.id });
      } else {
        await api.saveGymOwner(token, payload);
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
      await api.deleteGymOwner(token, deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleStatusChange(owner: GymOwner, newStatus: 'active' | 'suspended') {
    if (!token) return;
    try {
      await api.saveGymOwner(token, { id: owner.id, accountStatus: newStatus });
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
      });
      // Assign selected trainers to the new gym
      for (const tId of gymTrainerIds) {
        const trainer = trainers.find(t => t.id === tId);
        const currentGymIds = trainer?.gymIds || [];
        if (!currentGymIds.includes(created.id)) {
          await api.saveTrainer(token, { id: tId, gymIds: [...currentGymIds, created.id] });
        }
      }
      setGyms(prev => [...prev, created]);
      setDraftGymIds(prev => [...prev, created.id]);
      setGymDialogOpen(false);
      setNewGym({ ...BLANK_GYM_DRAFT });
      setGymTrainerIds([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create gym');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateTrainerInline() {
    if (!token) return;
    const errs = validateTrainerDraft(newTrainer);
    if (Object.keys(errs).length > 0) { setTrainerFormErrors(errs); return; }
    setTrainerFormErrors({});
    setBusy(true);
    try {
      const specialties = newTrainer.specialties.split(',').map(s => s.trim()).filter(Boolean);
      const created = await api.saveTrainer(token, {
        displayName: newTrainer.displayName,
        email: newTrainer.email,
        specialties,
        hourlyRateTzs: Number(newTrainer.hourlyRateTzs) || 0,
        gymIds: [],
        status: newTrainer.status as 'active' | 'suspended',
      });
      setTrainers(prev => [...prev, created]);
      setGymTrainerIds(prev => [...prev, created.id]);
      setTrainerDialogOpen(false);
      setNewTrainer({ ...BLANK_TRAINER_DRAFT });
    } catch (e: any) {
      if (e?.status === 409) {
        setTrainerFormErrors({ email: 'This email is already in use' });
      } else {
        setError(e instanceof Error ? e.message : 'Failed to create trainer');
      }
    } finally {
      setBusy(false);
    }
  }

  if (!token || user?.userType !== 'admin') return null;

  const gymName = (id?: string | null) => gyms.find(g => g.id === id)?.name || id || '—';

  const displayedOwners = filterGymId
    ? owners.filter(o => {
        const ids = o.gymIds || (o.gymId ? [o.gymId] : []);
        return ids.includes(filterGymId);
      })
    : owners;

  const columns: ColumnDef<GymOwner>[] = [
    {
      key: 'displayName', header: 'Owner', sortable: true,
      cell: (o) => (
        <div>
          <div className="font-medium text-[var(--color-fg-primary)]">{o.displayName || o.email || o.id}</div>
          <div className="text-xs text-[var(--color-fg-quaternary)]">{o.email || o.id}</div>
        </div>
      ),
    },
    {
      key: 'gymId', header: 'Gyms', sortable: true,
      cell: (o) => {
        const ids = o.gymIds || (o.gymId ? [o.gymId] : []);
        if (ids.length === 0) return <span className="text-xs text-[var(--color-fg-quaternary)]">—</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {ids.map(id => (
              <button
                key={id}
                onClick={(e) => { e.stopPropagation(); setFilterGymId(id); }}
                className="text-xs text-[var(--color-brand-700)] hover:underline inline-flex items-center gap-0.5"
              >
                {gymName(id)}
              </button>
            ))}
          </div>
        );
      },
    },
    { key: 'approvalStatus', header: 'Approval', sortable: true, cell: (o) => <Badge tone={statusTone(o.approvalStatus)}>{statusLabel(o.approvalStatus)}</Badge> },
    {
      key: 'accountStatus', header: 'Status', sortable: true,
      cell: (o) => (
        <select
          value={o.accountStatus || 'active'}
          onChange={(e) => handleStatusChange(o, e.target.value as 'active' | 'suspended')}
          onClick={(e) => e.stopPropagation()}
          className="appearance-none bg-transparent border-none text-xs font-medium cursor-pointer focus:outline-none"
          style={{ color: (o.accountStatus || 'active') === 'active' ? 'var(--color-success-700)' : 'var(--color-error-700)' }}
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
        title="Gym Owners"
        description={`${owners.length} gym owners registered.`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="primary" size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add owner
            </Button>
          </div>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      {loading && !owners.length ? (
        <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8" /></div>
      ) : (
        <Card>
          <div className="p-5">
            <DataTable
              columns={columns}
              data={displayedOwners}
              keyFn={(o) => o.id}
              filterPlaceholder="Search owners..."
              emptyState="No gym owners found."
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
              onRowClick={(owner) => openEdit(owner)}
              actions={(owner) => (
                <>
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openEdit(owner); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setDeleteTarget(owner); }}>
                    <Trash2 className="h-3.5 w-3.5 text-[var(--color-error-600)]" />
                  </Button>
                </>
              )}
            />
          </div>
        </Card>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? 'Edit owner' : 'Add owner'} description={editing ? `Editing ${editing.displayName || editing.email}` : 'Register a new gym owner.'} size="md">
        <div className="space-y-4">
          <Field label="Display name" error={formErrors.displayName}>
            <input className="ui-input" value={draft.displayName || ''} onChange={e => { setDraft({ ...draft, displayName: e.target.value }); setFormErrors(prev => { const { displayName, ...rest } = prev; return rest; }); }} />
          </Field>
          <Field label="Email" error={formErrors.email}>
            <input className="ui-input" type="email" value={draft.email || ''} onChange={e => { setDraft({ ...draft, email: e.target.value }); setFormErrors(prev => { const { email, ...rest } = prev; return rest; }); }} />
          </Field>
          <Field label="Gyms" hint="Owner can manage multiple gyms." error={formErrors.gyms}>
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
          <Field label="Status" error={formErrors.accountStatus}>
            <select className="ui-input" value={draft.accountStatus || 'active'} onChange={e => { setDraft({ ...draft, accountStatus: e.target.value as 'active' | 'suspended' }); setFormErrors(prev => { const { accountStatus, ...rest } = prev; return rest; }); }}>
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

      {/* Create Gym Inline Dialog — same form as Gyms page, owner select omitted (auto-assigned) */}
      <Dialog open={gymDialogOpen} onClose={() => setGymDialogOpen(false)} title="Create new gym" description="This gym will be automatically assigned to the owner you are editing." size="lg">
        <GymCreateForm
          draft={newGym}
          onChange={setNewGym}
          errors={gymFormErrors}
          onClearError={(k) => setGymFormErrors(prev => { const { [k]: _, ...rest } = prev; return rest; })}
          extraFields={
            <Field label="Trainers" hint="Select trainers for this gym (optional).">
              <SearchableSelect
                options={trainerOptions}
                value={gymTrainerIds}
                onChange={(v) => setGymTrainerIds(v as string[])}
                placeholder="Search trainers..."
                multiple
                allowCreate
                createLabel="Create new trainer"
                onCreateNew={() => setTrainerDialogOpen(true)}
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

      {/* Create Trainer Inline — same form as Trainers page, gym select omitted (auto-assigned) */}
      <Dialog open={trainerDialogOpen} onClose={() => setTrainerDialogOpen(false)} title="Create new trainer" description="This trainer will be assigned to the gym you are creating." size="md">
        <TrainerInlineForm
          draft={newTrainer}
          onChange={setNewTrainer}
          errors={trainerFormErrors}
          onClearError={(k) => setTrainerFormErrors(prev => { const { [k]: _, ...rest } = prev; return rest; })}
          hideGymSelect
          gyms={gyms}
        />
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setTrainerDialogOpen(false)} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="md" onClick={handleCreateTrainerInline} disabled={busy}>
            {busy ? 'Creating...' : 'Create trainer'}
          </Button>
        </DialogFooter>
      </Dialog>

      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title="Delete owner" description={`Remove "${deleteTarget?.displayName || deleteTarget?.email}"?`} confirmLabel="Delete" tone="danger" busy={busy} />
    </div>
  );
}
