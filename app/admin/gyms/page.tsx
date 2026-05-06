'use client';
import { useEffect, useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, RefreshCw, ChevronLeft, ChevronRight as ChevronRightIcon, Eye } from 'lucide-react';
import { useApp } from '../../providers';
import { api, Gym, GymOwner, TrainerProfile } from '@/lib/api';
import { Badge, Button, PageHeader, Alert, Spinner, Card, Field } from '@/components/shared';
import { DataTable, ColumnDef } from '@/components/data-table';
import { Dialog, DialogFooter } from '@/components/dialog';
import { ConfirmDialog } from '@/components/dialog';
import { SearchableSelect, SelectOption } from '@/components/searchable-select';
import { ImageUpload } from '@/components/image-upload';
import dynamic from 'next/dynamic';
const LocationPicker = dynamic(() => import('@/components/location-picker').then(m => ({ default: m.LocationPicker })), { ssr: false, loading: () => <div className="h-[260px] rounded-xl bg-[var(--color-bg-tertiary)] flex items-center justify-center text-xs text-[var(--color-fg-quaternary)]">Loading map...</div> });
import { GymScoringRubric, RubricData, RubricResult, EMPTY_RUBRIC } from '@/components/gym-scoring-rubric';
import { statusTone, statusLabel, money } from '@/lib/admin-utils';
import { OwnerInlineForm, OwnerFormDraft, BLANK_OWNER_DRAFT, validateOwnerDraft } from '@/components/owner-inline-form';
import { TrainerInlineForm, TrainerFormDraft, BLANK_TRAINER_DRAFT, validateTrainerDraft } from '@/components/trainer-inline-form';

const TIERS = ['standard', 'midtier', 'premium', 'luxury_executive'];
const STATUS_OPTIONS: { value: string; label: string; tone: 'success' | 'danger' | 'gray' }[] = [
  { value: 'active', label: 'Active', tone: 'success' },
  { value: 'inactive', label: 'Inactive', tone: 'gray' },
  { value: 'suspended', label: 'Suspended', tone: 'danger' },
];

const BLANK_GYM: Partial<Gym> = {
  name: '', location: '', tier: 'standard',
  ratePerDay: 5000, ratePerWeek: 25000, ratePerMonth: 80000,
  perVisitRate: 5000, commissionRate: 12, status: 'active',
  venueType: 'physical', accessMode: 'paid_visit',
  coordinates: { lat: -6.7924, lng: 39.2083 }, images: [],
};

export default function GymsPage() {
  const { token, user } = useApp();
  const [gyms, setGyms]         = useState<Gym[]>([]);
  const [owners, setOwners]     = useState<GymOwner[]>([]);
  const [trainers, setTrainers] = useState<TrainerProfile[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [busy, setBusy]         = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing]   = useState<Gym | null>(null);
  const [draft, setDraft]       = useState<Partial<Gym>>(BLANK_GYM);
  const [draftOwnerId, setDraftOwnerId] = useState<string>('');
  const [deleteTarget, setDeleteTarget] = useState<Gym | null>(null);
  const [detailGym, setDetailGym] = useState<Gym | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [ownerDialogOpen, setOwnerDialogOpen] = useState(false);
  const [newOwner, setNewOwner] = useState<OwnerFormDraft>({ ...BLANK_OWNER_DRAFT });
  const [draftTrainerIds, setDraftTrainerIds] = useState<string[]>([]);
  const [trainerDialogOpen, setTrainerDialogOpen] = useState(false);
  const [newTrainer, setNewTrainer] = useState<TrainerFormDraft>({ ...BLANK_TRAINER_DRAFT });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [ownerFormErrors, setOwnerFormErrors] = useState<Record<string, string>>({});
  const [trainerFormErrors, setTrainerFormErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState<1 | 2>(1);
  const [rubricData, setRubricData] = useState<RubricData>(EMPTY_RUBRIC);
  const [rubricResult, setRubricResult] = useState<RubricResult | null>(null);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [g, o, t] = await Promise.all([api.adminGyms(token), api.gymOwners(token), api.adminTrainers(token)]);
      setGyms(g);
      setOwners(o);
      setTrainers(t);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [token]);

  function openDetail(gym: Gym) {
    setDetailGym(gym);
    setSlideIndex(0);
  }

  const ownerOptions: SelectOption[] = useMemo(() =>
    owners.map(o => ({ value: o.id, label: o.displayName || o.email || o.id, sub: o.email || undefined })),
    [owners]
  );

  const trainerOptions: SelectOption[] = useMemo(() =>
    trainers.map(t => ({ value: t.id, label: t.displayName || t.email || t.id, sub: t.email || undefined })),
    [trainers]
  );

  const gymOwnerMap = useMemo(() => {
    const map: Record<string, GymOwner> = {};
    owners.forEach(o => {
      const ids = o.gymIds || (o.gymId ? [o.gymId] : []);
      ids.forEach((gId: string) => { map[gId] = o; });
    });
    return map;
  }, [owners]);

  function openCreate() {
    setEditing(null);
    setDraft({ ...BLANK_GYM });
    setDraftOwnerId('');
    setDraftTrainerIds([]);
    setFormErrors({});
    setStep(1);
    setRubricData(EMPTY_RUBRIC);
    setRubricResult(null);
    setDialogOpen(true);
  }

  function openEdit(gym: Gym) {
    setEditing(gym);
    setDraft({ ...gym });
    const owner = gymOwnerMap[gym.id];
    setDraftOwnerId(owner?.id || '');
    setDraftTrainerIds(trainers.filter(t => t.gymIds?.includes(gym.id)).map(t => t.id));
    setFormErrors({});
    setStep(1);
    setRubricData(EMPTY_RUBRIC);
    setRubricResult(null);
    setDialogOpen(true);
  }

  function validateStep1(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!draft.name?.trim()) errs.name = 'Name is required';
    if (!draft.location?.trim()) errs.location = 'Location is required';
    if (draft.ratePerDay == null || draft.ratePerDay <= 0) errs.ratePerDay = 'Day rate is required';
    if (draft.ratePerWeek == null || draft.ratePerWeek <= 0) errs.ratePerWeek = 'Week rate is required';
    if (draft.ratePerMonth == null || draft.ratePerMonth <= 0) errs.ratePerMonth = 'Month rate is required';
    if (draft.commissionRate == null || draft.commissionRate < 0) errs.commissionRate = 'Commission rate is required';
    if (!draft.images || draft.images.length === 0) errs.images = 'At least one image is required';
    if (!draftOwnerId) errs.owner = 'Owner is required';
    if (draft.coordinates?.lat == null) errs.lat = 'Location is required — use the map to set it';
    return errs;
  }

  function handleNextStep() {
    const errs = validateStep1();
    if (Object.keys(errs).length > 0) { setFormErrors(errs); return; }
    setFormErrors({});
    setStep(2);
  }

  function handleRubricResult(r: RubricResult) {
    setRubricResult(r);
    // Extract equipment list from rubric inventory
    const equipmentList = Object.entries(rubricData.equipInv)
      .filter(([, v]) => v?.present)
      .map(([name]) => name);
    // Extract amenities from wet inventory + manual scores
    const amenityList: string[] = [];
    for (const [name, v] of Object.entries(rubricData.wetInv || {})) {
      if (v?.present) amenityList.push(name);
    }
    if (rubricData.wifiLevel >= 3) amenityList.push('WiFi');
    for (const [id, score] of Object.entries(rubricData.manualScores || {})) {
      if ((score as number) >= 3) {
        const label = id === 'lockers' ? 'Lockers' : id === 'showers_quality' ? 'Showers' : id === 'climate' ? 'Climate Control' : id === 'towel_extras' ? 'Towel Service' : id;
        amenityList.push(label);
      }
    }
    setDraft(prev => ({ ...prev, tier: r.backendTier, amenities: amenityList, equipment: equipmentList }));
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
        photoUrl: newTrainer.photoUrl || undefined,
        specialties,
        hourlyRateTzs: Number(newTrainer.hourlyRateTzs) || 0,
        gymIds: [],
        status: newTrainer.status as 'active' | 'suspended',
      });
      setTrainers(prev => [...prev, created]);
      setDraftTrainerIds(prev => [...prev, created.id]);
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


  async function handleSave() {
    if (!token) return;
    if (step === 1) {
      const errs = validateStep1();
      if (Object.keys(errs).length > 0) { setFormErrors(errs); return; }
    }
    setBusy(true);
    try {
      let savedGym: Gym;
      if (editing) {
        savedGym = await api.saveGym(token, { ...draft, id: editing.id });
      } else {
        savedGym = await api.saveGym(token, draft);
      }
      if (draftOwnerId) {
        await api.saveGymOwner(token, { id: draftOwnerId, gymId: savedGym.id });
      }
      // Assign selected trainers to this gym
      for (const tId of draftTrainerIds) {
        const trainer = trainers.find(t => t.id === tId);
        const currentGymIds = trainer?.gymIds || [];
        if (!currentGymIds.includes(savedGym.id)) {
          await api.saveTrainer(token, { id: tId, gymIds: [...currentGymIds, savedGym.id] });
        }
      }
      // Remove gym from trainers that were de-selected
      const prevTrainerIds = trainers.filter(t => t.gymIds?.includes(savedGym.id)).map(t => t.id);
      for (const tId of prevTrainerIds) {
        if (!draftTrainerIds.includes(tId)) {
          const trainer = trainers.find(t => t.id === tId);
          const updated = (trainer?.gymIds || []).filter(gid => gid !== savedGym.id);
          await api.saveTrainer(token, { id: tId, gymIds: updated });
        }
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
      await api.deleteGym(token, deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (e: any) {
      const body = e?.body;
      let msg = 'Delete failed';
      if (e?.status === 409) {
        msg = body?.error === 'gym_has_activity_or_operator'
          ? `Cannot delete "${deleteTarget.name}" — it has an assigned operator or check-in activity. Remove the operator and check-ins first.`
          : (body?.error || 'Gym has existing activity and cannot be deleted.');
      } else if (e instanceof Error) {
        msg = e.message;
      }
      setError(msg);
      setDeleteTarget(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleStatusChange(gym: Gym, newStatus: string) {
    if (!token) return;
    try {
      await api.saveGym(token, { ...gym, status: newStatus });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Status update failed');
    }
  }

  async function handleCreateOwner() {
    if (!token) return;
    const errs = validateOwnerDraft(newOwner);
    if (Object.keys(errs).length > 0) { setOwnerFormErrors(errs); return; }
    setOwnerFormErrors({});
    setBusy(true);
    try {
      const created = await api.saveGymOwner(token, { displayName: newOwner.displayName, email: newOwner.email, accountStatus: newOwner.accountStatus as 'active' | 'suspended' });
      setOwners(prev => [...prev, created]);
      setDraftOwnerId(created.id);
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

  const columns: ColumnDef<Gym>[] = [
    {
      key: 'name', header: 'Gym', sortable: true,
      cell: (gym) => (
        <button onClick={(e) => { e.stopPropagation(); openDetail(gym); }} className="flex items-center gap-3 text-left group">
          <div className="h-10 w-14 overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-bg-tertiary)]">
            {gym.images?.[0] ? <img src={gym.images[0]} alt={gym.name} className="h-full w-full object-cover" /> : null}
          </div>
          <div>
            <div className="font-medium text-[var(--color-fg-primary)] group-hover:text-[var(--color-brand-700)] transition-colors">{gym.name}</div>
            <div className="text-xs text-[var(--color-fg-quaternary)]">{gym.tier}</div>
          </div>
        </button>
      ),
    },
    { key: 'location', header: 'Location', sortable: true, cell: (gym) => <span className="text-sm">{gym.location}</span> },
    {
      key: 'owner', header: 'Owner', sortable: false,
      cell: (gym) => {
        const owner = gymOwnerMap[gym.id];
        return owner ? (
          <span className="text-sm text-[var(--color-fg-secondary)]">
            {owner.displayName || owner.email || owner.id}
          </span>
        ) : <span className="text-xs text-[var(--color-fg-quaternary)]">—</span>;
      },
    },
    { key: 'ratePerDay', header: 'Day rate', sortable: true, align: 'right', cell: (gym) => <span className="tabular-nums text-sm">{money(gym.ratePerDay ?? gym.perVisitRate)}</span> },
    { key: 'ratePerWeek', header: 'Week rate', sortable: true, align: 'right', cell: (gym) => <span className="tabular-nums text-sm">{money(gym.ratePerWeek ?? 0)}</span> },
    { key: 'ratePerMonth', header: 'Month rate', sortable: true, align: 'right', cell: (gym) => <span className="tabular-nums text-sm">{money(gym.ratePerMonth ?? 0)}</span> },
    {
      key: 'status', header: 'Status', sortable: true,
      cell: (gym) => (
        <select
          value={gym.status}
          onChange={(e) => handleStatusChange(gym, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className="appearance-none bg-transparent border-none text-xs font-medium cursor-pointer focus:outline-none"
          style={{ color: gym.status === 'active' ? 'var(--color-success-700)' : gym.status === 'suspended' ? 'var(--color-error-700)' : 'var(--color-fg-tertiary)' }}
        >
          {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gyms"
        description={`${gyms.length} gyms registered on the platform.`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="primary" size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Create gym
            </Button>
          </div>
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      {loading && !gyms.length ? (
        <div className="flex h-64 items-center justify-center"><Spinner className="h-8 w-8" /></div>
      ) : (
        <Card>
          <div className="p-5">
            <DataTable
              columns={columns}
              data={gyms}
              keyFn={(g) => g.id}
              filterPlaceholder="Search gyms..."
              emptyState="No gyms found."
              onRowClick={(gym) => openDetail(gym)}
              actions={(gym) => (
                <>
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openDetail(gym); }} title="View details">
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openEdit(gym); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setDeleteTarget(gym); }}>
                    <Trash2 className="h-3.5 w-3.5 text-[var(--color-error-600)]" />
                  </Button>
                </>
              )}
            />
          </div>
        </Card>
      )}

      {/* Create/Edit Dialog — Two Steps */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? `Edit gym${step === 2 ? ' — Amenities & Scoring' : ''}` : `Create gym — Step ${step} of 2`}
        description={step === 1 ? (editing ? `Editing ${editing.name}` : 'Basic information, pricing, and images.') : 'Score amenities and equipment to auto-determine gym tier.'}
        size={step === 2 ? 'xl' : 'lg'}
      >
        {step === 1 ? (
          <>
            <div className="space-y-4">
              {/* Step indicator */}
              <div className="flex items-center gap-2 mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="h-6 w-6 rounded-full bg-[var(--color-brand-600)] text-white text-xs font-bold flex items-center justify-center">1</span>
                  <span className="text-xs font-medium text-[var(--color-fg-primary)]">Basic Info</span>
                </div>
                <div className="flex-1 h-px bg-[var(--color-border-secondary)]" />
                <div className="flex items-center gap-1.5">
                  <span className="h-6 w-6 rounded-full bg-[var(--color-bg-tertiary)] text-[var(--color-fg-quaternary)] text-xs font-bold flex items-center justify-center">2</span>
                  <span className="text-xs text-[var(--color-fg-quaternary)]">Amenities & Tier</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Name" error={formErrors.name}>
                  <input className="ui-input" value={draft.name || ''} onChange={e => { setDraft({ ...draft, name: e.target.value }); setFormErrors(prev => { const { name, ...rest } = prev; return rest; }); }} />
                </Field>
                <Field label="Location" error={formErrors.location}>
                  <input className="ui-input" value={draft.location || ''} onChange={e => { setDraft({ ...draft, location: e.target.value }); setFormErrors(prev => { const { location, ...rest } = prev; return rest; }); }} />
                </Field>
              </div>
              <Field label="Status">
                <select className="ui-input" value={draft.status || 'active'} onChange={e => setDraft({ ...draft, status: e.target.value as Gym['status'] })}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="suspended">Suspended</option>
                </select>
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="Rate per day (TZS)" error={formErrors.ratePerDay}>
                  <input className="ui-input" type="number" value={draft.ratePerDay || ''} placeholder="0" onChange={e => { const v = e.target.value === '' ? 0 : Number(e.target.value); setDraft({ ...draft, ratePerDay: v, perVisitRate: v }); setFormErrors(prev => { const { ratePerDay, ...rest } = prev; return rest; }); }} />
                </Field>
                <Field label="Rate per week (TZS)" error={formErrors.ratePerWeek}>
                  <input className="ui-input" type="number" value={draft.ratePerWeek || ''} placeholder="0" onChange={e => { setDraft({ ...draft, ratePerWeek: e.target.value === '' ? 0 : Number(e.target.value) }); setFormErrors(prev => { const { ratePerWeek, ...rest } = prev; return rest; }); }} />
                </Field>
                <Field label="Rate per month (TZS)" error={formErrors.ratePerMonth}>
                  <input className="ui-input" type="number" value={draft.ratePerMonth || ''} placeholder="0" onChange={e => { setDraft({ ...draft, ratePerMonth: e.target.value === '' ? 0 : Number(e.target.value) }); setFormErrors(prev => { const { ratePerMonth, ...rest } = prev; return rest; }); }} />
                </Field>
              </div>
              <Field label="Commission %" error={formErrors.commissionRate}>
                <input className="ui-input" type="number" value={draft.commissionRate || ''} placeholder="0" onChange={e => { setDraft({ ...draft, commissionRate: e.target.value === '' ? 0 : Number(e.target.value) }); setFormErrors(prev => { const { commissionRate, ...rest } = prev; return rest; }); }} />
              </Field>
              <Field label="Owner" error={formErrors.owner}>
                <SearchableSelect
                  options={ownerOptions}
                  value={draftOwnerId}
                  onChange={(v) => { setDraftOwnerId(v as string); setFormErrors(prev => { const { owner, ...rest } = prev; return rest; }); }}
                  placeholder="Search or select owner..."
                  allowCreate
                  createLabel="Create new owner"
                  onCreateNew={() => setOwnerDialogOpen(true)}
                />
              </Field>
              <Field label="Trainers" hint="Select trainers for this gym.">
                <SearchableSelect
                  options={trainerOptions}
                  value={draftTrainerIds}
                  onChange={(v) => setDraftTrainerIds(v as string[])}
                  placeholder="Search trainers..."
                  multiple
                  allowCreate
                  createLabel="Create new trainer"
                  onCreateNew={() => setTrainerDialogOpen(true)}
                />
              </Field>
              <Field label="Location on map" hint="Click the map or search to set the gym location." error={formErrors.lat}>
                <LocationPicker
                  lat={draft.coordinates?.lat ?? null}
                  lng={draft.coordinates?.lng ?? null}
                  onChange={(lat, lng) => {
                    setDraft({ ...draft, coordinates: { lat, lng } });
                    setFormErrors(prev => { const { lat: _, ...rest } = prev; return rest; });
                  }}
                />
              </Field>
              <Field label="Gym images" hint="Upload gym photos. PNG, JPG, or WEBP." error={formErrors.images}>
                <ImageUpload
                  value={draft.images || []}
                  onChange={(imgs) => { setDraft({ ...draft, images: imgs }); setFormErrors(prev => { const { images, ...rest } = prev; return rest; }); }}
                  maxFiles={5}
                />
              </Field>
            </div>
            <DialogFooter>
              <Button variant="secondary" size="md" onClick={() => setDialogOpen(false)} disabled={busy}>Cancel</Button>
              {editing ? (
                <>
                  <Button variant="secondary" size="md" onClick={handleNextStep}>
                    Edit Amenities <ChevronRightIcon className="h-4 w-4" />
                  </Button>
                  <Button variant="primary" size="md" onClick={handleSave} disabled={busy}>
                    {busy ? 'Saving...' : 'Update'}
                  </Button>
                </>
              ) : (
                <Button variant="primary" size="md" onClick={handleNextStep}>
                  Next: Amenities & Scoring <ChevronRightIcon className="h-4 w-4" />
                </Button>
              )}
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4">
              {/* Step indicator */}
              <div className="flex items-center gap-2 mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="h-6 w-6 rounded-full bg-[var(--color-success-600)] text-white text-xs font-bold flex items-center justify-center">&#10003;</span>
                  <span className="text-xs text-[var(--color-success-600)] font-medium">Basic Info</span>
                </div>
                <div className="flex-1 h-px bg-[var(--color-brand-600)]" />
                <div className="flex items-center gap-1.5">
                  <span className="h-6 w-6 rounded-full bg-[var(--color-brand-600)] text-white text-xs font-bold flex items-center justify-center">2</span>
                  <span className="text-xs font-medium text-[var(--color-fg-primary)]">Amenities & Tier</span>
                </div>
              </div>

              {/* Auto-tier badge */}
              {rubricResult && (
                <div className="rounded-[var(--radius-lg)] border-2 border-[var(--color-brand-200)] bg-[var(--color-brand-50)] p-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-[var(--color-fg-quaternary)]">Auto-determined tier</p>
                    <p className="text-lg font-bold text-[var(--color-brand-700)]">{rubricResult.tier.charAt(0).toUpperCase() + rubricResult.tier.slice(1)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-[var(--color-fg-quaternary)]">Score</p>
                    <p className="text-lg font-bold font-mono tabular-nums text-[var(--color-brand-600)]">{rubricResult.finalScore.toFixed(2)}</p>
                  </div>
                </div>
              )}

              <GymScoringRubric data={rubricData} onChange={setRubricData} onResult={handleRubricResult} />
            </div>
            <DialogFooter>
              <Button variant="secondary" size="md" onClick={() => setStep(1)}>
                <ChevronLeft className="h-4 w-4" /> Back
              </Button>
              <Button variant="primary" size="md" onClick={handleSave} disabled={busy}>
                {busy ? 'Saving...' : editing ? 'Update Gym' : 'Create Gym'}
              </Button>
            </DialogFooter>
          </>
        )}
      </Dialog>

      {/* Create Owner Inline Dialog — same form as Owners page, gym select omitted (auto-assigned) */}
      <Dialog
        open={ownerDialogOpen}
        onClose={() => setOwnerDialogOpen(false)}
        title="Create new owner"
        description="This owner will be automatically assigned to the gym you are creating."
        size="md"
      >
        <OwnerInlineForm
          draft={newOwner}
          onChange={setNewOwner}
          errors={ownerFormErrors}
          onClearError={(k) => setOwnerFormErrors(prev => { const { [k]: _, ...rest } = prev; return rest; })}
          hideGymSelect
        />
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setOwnerDialogOpen(false)} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="md" onClick={handleCreateOwner} disabled={busy}>
            {busy ? 'Creating...' : 'Create owner'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Create Trainer Inline Dialog — same form as Trainers page, gym select omitted (auto-assigned) */}
      <Dialog
        open={trainerDialogOpen}
        onClose={() => setTrainerDialogOpen(false)}
        title="Create new trainer"
        description="This trainer will be automatically assigned to the gym you are creating."
        size="md"
      >
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

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete gym"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        tone="danger"
        busy={busy}
      />

      {/* Gym Detail Dialog */}
      <Dialog
        open={!!detailGym}
        onClose={() => setDetailGym(null)}
        title={detailGym?.name || ''}
        description={detailGym?.location || ''}
        size="xl"
      >
        {detailGym && (
          <div className="space-y-5">
            {/* Image slider */}
            {detailGym.images && detailGym.images.length > 0 ? (
              <div className="relative">
                <div className="aspect-[16/9] w-full overflow-hidden rounded-[var(--radius-xl)] bg-[var(--color-bg-tertiary)]">
                  <img
                    src={detailGym.images[slideIndex] || ''}
                    alt={`${detailGym.name} ${slideIndex + 1}`}
                    className="h-full w-full object-cover"
                  />
                </div>
                {detailGym.images.length > 1 && (
                  <>
                    <button
                      onClick={() => setSlideIndex(i => (i - 1 + detailGym.images!.length) % detailGym.images!.length)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setSlideIndex(i => (i + 1) % detailGym.images!.length)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
                    >
                      <ChevronRightIcon className="h-4 w-4" />
                    </button>
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
                      {detailGym.images.map((_, idx) => (
                        <button
                          key={idx}
                          onClick={() => setSlideIndex(idx)}
                          className={`h-2 w-2 rounded-full transition-colors ${idx === slideIndex ? 'bg-white' : 'bg-white/40'}`}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="aspect-[16/9] w-full rounded-[var(--radius-xl)] bg-[var(--color-bg-tertiary)] flex items-center justify-center text-[var(--color-fg-quaternary)] text-sm">
                No images
              </div>
            )}

            {/* Detail grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-[var(--color-fg-quaternary)] mb-0.5">Tier</p>
                <Badge tone="brand">{detailGym.tier.toUpperCase()}</Badge>
              </div>
              <div>
                <p className="text-xs text-[var(--color-fg-quaternary)] mb-0.5">Status</p>
                <Badge tone={statusTone(detailGym.status)}>{statusLabel(detailGym.status)}</Badge>
              </div>
              <div>
                <p className="text-xs text-[var(--color-fg-quaternary)] mb-0.5">Commission</p>
                <p className="text-sm font-medium">{detailGym.commissionRate}%</p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-fg-quaternary)] mb-0.5">Owner</p>
                <p className="text-sm font-medium">{gymOwnerMap[detailGym.id]?.displayName || gymOwnerMap[detailGym.id]?.email || '—'}</p>
              </div>
            </div>

            {/* Pricing */}
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3 text-center">
                <p className="text-xs text-[var(--color-fg-quaternary)] mb-1">Per Day</p>
                <p className="text-lg font-semibold tabular-nums">{money(detailGym.ratePerDay ?? detailGym.perVisitRate)}</p>
              </div>
              <div className="rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3 text-center">
                <p className="text-xs text-[var(--color-fg-quaternary)] mb-1">Per Week</p>
                <p className="text-lg font-semibold tabular-nums">{money(detailGym.ratePerWeek ?? 0)}</p>
              </div>
              <div className="rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3 text-center">
                <p className="text-xs text-[var(--color-fg-quaternary)] mb-1">Per Month</p>
                <p className="text-lg font-semibold tabular-nums">{money(detailGym.ratePerMonth ?? 0)}</p>
              </div>
            </div>

            {/* Amenities */}
            {detailGym.amenities && detailGym.amenities.length > 0 && (
              <div>
                <p className="text-xs text-[var(--color-fg-quaternary)] mb-1.5">Amenities</p>
                <div className="flex flex-wrap gap-1.5">
                  {detailGym.amenities.map(a => <Badge key={a} tone="brand">{a}</Badge>)}
                </div>
              </div>
            )}

            {/* Equipment */}
            {detailGym.equipment && detailGym.equipment.length > 0 && (
              <div>
                <p className="text-xs text-[var(--color-fg-quaternary)] mb-1.5">Equipment</p>
                <div className="flex flex-wrap gap-1.5">
                  {detailGym.equipment.map(e => <Badge key={e} tone="gray">{e}</Badge>)}
                </div>
              </div>
            )}

            {/* Coordinates */}
            {detailGym.coordinates?.lat && (
              <div>
                <p className="text-xs text-[var(--color-fg-quaternary)] mb-0.5">Coordinates</p>
                <p className="text-sm">{detailGym.coordinates.lat}, {detailGym.coordinates.lng}</p>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setDetailGym(null)}>Close</Button>
          <Button variant="primary" size="md" onClick={() => { if (detailGym) { openEdit(detailGym); setDetailGym(null); } }}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
          <Button variant="destructive" size="md" onClick={() => { if (detailGym) { setDeleteTarget(detailGym); setDetailGym(null); } }}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
