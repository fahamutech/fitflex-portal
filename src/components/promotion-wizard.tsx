'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Search, XCircle } from 'lucide-react';
import { useApp } from '../../app/providers';
import {
  api, CapacityRow, EntityMatch, GeoArea, ModerationEntityType, PartnerMatch, PromotionInput, PromotionPlacement, PromotionPreview,
  PromotionReference, PromotionType, PromotionCampaign,
} from '@/lib/api';
import { TYPE_KEY as ENTITY_TYPE_KEY } from '@/lib/moderation';
import { whyKey } from '@/lib/moderation';
import {
  COMMERCIAL_RELATIONSHIPS, NON_COMMERCIAL_RELATIONSHIPS, PLACEMENT_KEY, PROMOTION_TYPES, REL_KEY, TYPE_HINT_KEY, TYPE_KEY,
  dateTime, errorKey, scopeSummary,
} from '@/lib/promotions';
import { Alert, Badge, Button, Card, CardContent, Field, Spinner } from '@/components/shared';
import { Stepper } from '@/components/stepper';
import { DateTimeInput } from '@/components/datetime-input';
import { AreaPicker } from '@/components/area-picker';

const STEP_KEYS = ['entity', 'type', 'placement', 'targeting', 'schedule', 'priority', 'commercial', 'review'] as const;
type StepKey = typeof STEP_KEYS[number];
const ENTITY_TYPES: ModerationEntityType[] = ['gym', 'trainer', 'vendor', 'product'];

type Draft = {
  entity: EntityMatch | null; type: PromotionType | null; placements: PromotionPlacement[]; areaIds: string[]; categories: string;
  startsAt: string; endsAt: string; priority: string; boostWeight: string;
  isCommercial: boolean; relationshipType: string; partner: PartnerMatch | null; commercialRef: string; campaignId: string; disclosureLabel: string; notes: string;
};
const EMPTY: Draft = {
  entity: null, type: null, placements: [], areaIds: [], categories: '', startsAt: '', endsAt: '', priority: '10', boostWeight: '1',
  isCommercial: false, relationshipType: 'editorial', partner: null, commercialRef: '', campaignId: '', disclosureLabel: '', notes: '',
};

/** What a type means for the commercial step: Sponsored is always paid, Recommended never is. */
const commercialFixed = (type: PromotionType | null): boolean | null => (type === 'sponsored' ? true : type === 'recommended' ? false : null);

/**
 * Create or edit a promotion, one decision at a time, ending in a review that
 * checks the entity and the placements' room before anything is saved. Saves as
 * a draft, or saves and sends it for approval. Approving is someone else's job.
 */
export function PromotionWizard({ editId, onClose, onSaved }: { editId?: string | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { token, t } = useApp();
  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(0);
  const [d, setD] = useState<Draft>(EMPTY);
  const [ref, setRef] = useState<PromotionReference | null>(null);
  const [areas, setAreas] = useState<GeoArea[]>([]);
  const [campaigns, setCampaigns] = useState<PromotionCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PromotionPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setD(prev => ({ ...prev, ...patch }));

  // Reference data, and the draft being edited.
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const [r, g, c] = await Promise.all([api.promotionReference(token), api.geoAreas(token), api.promotionCampaigns(token)]);
        setRef(r); setAreas(g.areas); setCampaigns(c.items.filter(x => x.status === 'draft' || x.status === 'active'));
        if (editId) {
          const { promotion: p } = await api.promotionDetail(token, editId);
          const partner = p.partnerRef ? (await api.searchPromotionPartners(token, '')).items.find(o => o.id === p.partnerRef) ?? { id: p.partnerRef, name: p.partnerRef, legalName: p.partnerRef, type: '', status: '' } : null;
          setD({
            entity: { entityType: p.entityType, id: p.entityId, name: p.entity?.name ?? p.entityId, subtitle: p.entity?.subtitle ?? null, status: p.entity?.status ?? '', moderationStatus: 'approved', promotable: true, reasons: [],
              placements: (Object.entries(r.placements) as Array<[PromotionPlacement, { entityTypes: ModerationEntityType[] }]>).filter(([, v]) => v.entityTypes.includes(p.entityType)).map(([k]) => k) },
            type: p.type, placements: p.placements, areaIds: p.geoScope?.areaIds ?? [], categories: (p.categories ?? []).join(', '),
            startsAt: p.startsAt, endsAt: p.endsAt, priority: String(p.priority), boostWeight: String(p.boostWeight),
            isCommercial: p.isCommercial, relationshipType: p.relationshipType ?? (p.isCommercial ? 'paid_advertising' : 'editorial'), partner, commercialRef: p.commercialRef ?? '',
            campaignId: p.campaignId ?? '', disclosureLabel: p.disclosureLabel ?? '', notes: p.notes ?? '',
          });
          setMaxReached(STEP_KEYS.length - 1);
        }
      } catch (err) {
        setError(t(errorKey(err)));
      } finally {
        setLoading(false);
      }
    })();
  }, [token, editId, t]);

  const now = Date.now();
  const valid = useMemo<Record<StepKey, boolean>>(() => {
    const prio = Number(d.priority);
    const weight = Number(d.boostWeight);
    const fixed = commercialFixed(d.type);
    const commercial = fixed ?? d.isCommercial;
    return {
      entity: !!d.entity && (d.entity.promotable || !!editId),
      type: !!d.type,
      placement: d.placements.length > 0 && d.placements.every(p => d.entity?.placements.includes(p)),
      targeting: true,
      schedule: !!d.startsAt && !!d.endsAt && new Date(d.endsAt) > new Date(d.startsAt) && new Date(d.endsAt).getTime() > now,
      priority: Number.isInteger(prio) && prio >= 1 && prio <= (ref?.maxPriority ?? 100) && Number.isFinite(weight) && weight >= 0 && weight <= 1,
      commercial: (d.type !== 'campaign' || !!d.campaignId) && (!commercial || COMMERCIAL_RELATIONSHIPS.includes(d.relationshipType)),
      review: true,
    };
  }, [d, ref, editId, now]);

  const body = useMemo<PromotionInput | null>(() => {
    if (!d.entity || !d.type) return null;
    const commercial = commercialFixed(d.type) ?? d.isCommercial;
    return {
      entityType: d.entity.entityType, entityId: d.entity.id, type: d.type, placements: d.placements, startsAt: d.startsAt, endsAt: d.endsAt,
      priority: Number(d.priority), boostWeight: Number(d.boostWeight), geoScope: { areaIds: d.areaIds },
      categories: d.categories.split(',').map(c => c.trim()).filter(Boolean), campaignId: d.campaignId || null, partnerRef: d.partner?.id ?? null,
      isCommercial: commercial, relationshipType: commercial ? d.relationshipType : (NON_COMMERCIAL_RELATIONSHIPS.includes(d.relationshipType) ? d.relationshipType : 'editorial'),
      commercialRef: d.commercialRef.trim() || null, disclosureLabel: d.disclosureLabel.trim() || null, notes: d.notes.trim() || null,
    };
  }, [d]);

  const loadPreview = useCallback(async () => {
    if (!token || !body) return;
    setPreview(null); setPreviewError(null);
    try {
      setPreview(await api.previewPromotion(token, body));
    } catch (err) {
      setPreviewError(t(errorKey(err)));
    }
  }, [token, body, t]);
  useEffect(() => { if (STEP_KEYS[step] === 'review') loadPreview(); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (i: number) => { setStep(i); setMaxReached(m => Math.max(m, i)); };
  const labels: Record<StepKey, string> = {
    entity: t('pro.wiz.step.entity'), type: t('pro.wiz.step.type'), placement: t('pro.wiz.step.placement'), targeting: t('pro.wiz.step.targeting'),
    schedule: t('pro.wiz.step.schedule'), priority: t('pro.wiz.step.priority'), commercial: t('pro.wiz.step.commercial'), review: t('pro.wiz.step.review'),
  };
  const key = STEP_KEYS[step];

  const save = async (submit: boolean) => {
    if (!token || !body) return;
    setBusy(true); setError(null);
    let id = editId ?? null;
    try {
      if (editId) {
        const { entityType: _a, entityId: _b, ...rest } = body; // eslint-disable-line @typescript-eslint/no-unused-vars
        await api.updatePromotion(token, editId, rest);
      } else {
        id = (await api.createPromotion(token, body)).promotion.id;
      }
    } catch (err) {
      setError(t(errorKey(err))); setBusy(false); return;
    }
    if (submit && id) {
      try { await api.promotionAction(token, id, 'submit'); }
      catch (err) { setError(`${t('pro.wiz.savedNotSubmitted')} ${t(errorKey(err))}`); setBusy(false); onSaved(id); return; }
    }
    setBusy(false);
    onSaved(id!);
  };

  if (loading) return <div className="p-6"><Spinner className="h-6 w-6" /></div>;

  return (
    <div className="space-y-6" data-testid="promotion-wizard">
      <button onClick={onClose} className="flex items-center gap-1.5 text-sm text-[var(--color-fg-tertiary)] hover:text-[var(--color-fg-primary)]" data-testid="wizard-cancel">
        <ArrowLeft className="h-4 w-4" />{t('pro.back')}
      </button>
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-fg-primary)]">{editId ? t('pro.wiz.titleEdit') : t('pro.wiz.title')}</h1>
        <p className="text-sm text-[var(--color-fg-tertiary)]">{t('pro.wiz.description')}</p>
      </div>
      <Stepper steps={STEP_KEYS.map(k => ({ key: k, label: labels[k] }))} current={step} maxReached={maxReached} onStep={setStep} />
      {error && <Alert tone="error">{error}</Alert>}

      <Card>
        <CardContent className="space-y-5 py-6">
          {key === 'entity' && <EntityStep d={d} set={set} locked={!!editId} />}
          {key === 'type' && (
            <div className="space-y-3">
              <h2 className="font-semibold">{t('pro.wiz.type.title')}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {PROMOTION_TYPES.map(ty => (
                  <button key={ty} type="button" onClick={() => {
                    const fixed = commercialFixed(ty);
                    set({ type: ty, ...(fixed === true ? { isCommercial: true, relationshipType: COMMERCIAL_RELATIONSHIPS.includes(d.relationshipType) ? d.relationshipType : 'paid_advertising' }
                      : fixed === false ? { isCommercial: false, relationshipType: 'editorial' } : {}) });
                  }} data-testid={`type-${ty}`}
                    className={`rounded-[var(--radius-lg)] border p-4 text-left ${d.type === ty ? 'border-[var(--color-brand-600)] bg-[var(--color-brand-50)]' : 'border-[var(--color-border-secondary)] hover:bg-[var(--color-bg-secondary)]'}`}>
                    <p className="font-medium">{t(TYPE_KEY[ty])}</p>
                    <p className="mt-1 text-sm text-[var(--color-fg-tertiary)]">{t(TYPE_HINT_KEY[ty])}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
          {key === 'placement' && (
            <div className="space-y-3">
              <h2 className="font-semibold">{t('pro.wiz.placement.title')}</h2>
              <p className="text-sm text-[var(--color-fg-tertiary)]">{t('pro.wiz.placement.hint')}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {(d.entity?.placements ?? []).map(pl => (
                  <label key={pl} className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-secondary)] p-3 text-sm">
                    <input type="checkbox" checked={d.placements.includes(pl)} data-testid={`placement-${pl}`}
                      onChange={() => set({ placements: d.placements.includes(pl) ? d.placements.filter(x => x !== pl) : [...d.placements, pl] })} />
                    {t(PLACEMENT_KEY[pl])}
                  </label>
                ))}
              </div>
            </div>
          )}
          {key === 'targeting' && (
            <div className="space-y-4">
              <h2 className="font-semibold">{t('pro.wiz.targeting.title')}</h2>
              <Field label={t('pro.wiz.targeting.areas')} hint={t('pro.wiz.targeting.areasHint')}>
                <AreaPicker areas={areas} value={d.areaIds} onChange={areaIds => set({ areaIds })} />
              </Field>
              <Field label={t('pro.wiz.targeting.categories')} hint={t('pro.wiz.targeting.categoriesHint')}>
                <input className="ui-input" value={d.categories} onChange={e => set({ categories: e.target.value })} maxLength={200} data-testid="wizard-categories" />
              </Field>
            </div>
          )}
          {key === 'schedule' && (
            <div className="space-y-4">
              <h2 className="font-semibold">{t('pro.wiz.schedule.title')}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('pro.wiz.schedule.start')}><DateTimeInput value={d.startsAt} onChange={startsAt => set({ startsAt })} data-testid="wizard-start" /></Field>
                <Field label={t('pro.wiz.schedule.end')}><DateTimeInput value={d.endsAt} onChange={endsAt => set({ endsAt })} min={d.startsAt || undefined} data-testid="wizard-end" /></Field>
              </div>
              {d.startsAt && d.endsAt && !valid.schedule && <Alert tone="error">{t('pro.wiz.schedule.invalid')}</Alert>}
              <p className="text-sm text-[var(--color-fg-tertiary)]">{t('pro.wiz.schedule.hint')}</p>
            </div>
          )}
          {key === 'priority' && (
            <div className="space-y-4">
              <h2 className="font-semibold">{t('pro.wiz.priority.title')}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('pro.wiz.priority.priority')} hint={t('pro.wiz.priority.priorityHint').replace('{max}', String(ref?.maxPriority ?? 100))}>
                  <input className="ui-input" type="number" min={1} max={ref?.maxPriority ?? 100} value={d.priority} onChange={e => set({ priority: e.target.value })} data-testid="wizard-priority" />
                </Field>
                <Field label={t('pro.wiz.priority.weight')} hint={t('pro.wiz.priority.weightHint')}>
                  <input className="ui-input" type="number" min={0} max={1} step={0.05} value={d.boostWeight} onChange={e => set({ boostWeight: e.target.value })} data-testid="wizard-weight" />
                </Field>
              </div>
              {!valid.priority && <Alert tone="error">{t('pro.err.invalid_priority')}</Alert>}
            </div>
          )}
          {key === 'commercial' && <CommercialStep d={d} set={set} campaigns={campaigns} />}
          {key === 'review' && (
            <ReviewStep d={d} body={body} areas={areas} preview={preview} previewError={previewError} />
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" onClick={() => (step === 0 ? onClose() : setStep(step - 1))}>{step === 0 ? t('pro.cancel') : t('pro.wiz.prev')}</Button>
        {key !== 'review' ? (
          <Button onClick={() => go(step + 1)} disabled={!valid[key]} data-testid="wizard-next">{t('pro.wiz.next')}<ArrowRight className="h-4 w-4" /></Button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => save(false)} disabled={busy || !!previewError} data-testid="wizard-save-draft">{t('pro.wiz.saveDraft')}</Button>
            <Button onClick={() => save(true)} disabled={busy || !!previewError || !!preview && !preview.eligibility.ok} data-testid="wizard-submit">
              <Check className="h-4 w-4" />{t('pro.wiz.submit')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function EntityStep({ d, set, locked }: { d: Draft; set: (p: Partial<Draft>) => void; locked: boolean }) {
  const { token, t } = useApp();
  const [type, setType] = useState<ModerationEntityType>(d.entity?.entityType ?? 'gym');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<EntityMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || locked) return;
    setResults(null); setError(null);
    const h = setTimeout(async () => {
      try { setResults((await api.searchPromotionEntities(token, type, q.trim())).items); }
      catch (err) { setError(t(errorKey(err))); setResults([]); }
    }, q ? 250 : 0);
    return () => clearTimeout(h);
  }, [token, type, q, locked, t]);

  if (locked && d.entity) {
    return (
      <div className="space-y-2">
        <h2 className="font-semibold">{t('pro.wiz.entity.title')}</h2>
        <p className="rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] p-3 text-sm" data-testid="wizard-entity-locked">
          <span className="text-xs uppercase text-[var(--color-fg-quaternary)]">{t(ENTITY_TYPE_KEY[d.entity.entityType])}</span><br />
          <span className="font-medium">{d.entity.name}</span>
        </p>
        <p className="text-sm text-[var(--color-fg-tertiary)]">{t('pro.wiz.entity.locked')}</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <h2 className="font-semibold">{t('pro.wiz.entity.title')}</h2>
      <div className="flex flex-wrap gap-2" role="tablist">
        {ENTITY_TYPES.map(ty => (
          <button key={ty} role="tab" aria-selected={type === ty} type="button" data-testid={`entity-type-${ty}`}
            onClick={() => { setType(ty); if (d.entity && d.entity.entityType !== ty) set({ entity: null, placements: [] }); }}
            className={`rounded-full border px-3 py-1 text-sm ${type === ty ? 'border-[var(--color-brand-600)] bg-[var(--color-brand-600)] text-white' : 'border-[var(--color-border-secondary)]'}`}>
            {t(ENTITY_TYPE_KEY[ty])}
          </button>
        ))}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-fg-quaternary)]" />
        <input className="ui-input" style={{ paddingLeft: 36 }} type="search" placeholder={t('pro.wiz.entity.search')} value={q} onChange={e => setQ(e.target.value)} data-testid="wizard-entity-search" />
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {results == null ? <Spinner className="h-5 w-5" /> : results.length === 0 ? (
        <p className="text-sm text-[var(--color-fg-quaternary)]">{t('pro.wiz.entity.none')}</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border-secondary)] rounded-[var(--radius-md)] border border-[var(--color-border-secondary)]" data-testid="wizard-entity-results">
          {results.map(r => (
            <li key={r.id}>
              <button type="button" disabled={!r.promotable} onClick={() => set({ entity: r, placements: d.placements.filter(p => r.placements.includes(p)) })}
                data-testid={`entity-${r.id}`}
                className={`flex w-full items-start justify-between gap-3 p-3 text-left text-sm ${d.entity?.id === r.id ? 'bg-[var(--color-brand-50)]' : r.promotable ? 'hover:bg-[var(--color-bg-secondary)]' : 'cursor-not-allowed opacity-60'}`}>
                <span>
                  <span className="font-medium">{r.name}</span>
                  {r.subtitle && <span className="block text-xs text-[var(--color-fg-quaternary)]">{r.subtitle}</span>}
                  {!r.promotable && (
                    <span className="mt-1 flex items-start gap-1 text-xs text-[var(--color-error-600)]">
                      <XCircle className="mt-0.5 h-3 w-3 shrink-0" />
                      {r.reasons.map(c => { const k = whyKey(c); return k ? t(k) : c; }).join('; ')}
                    </span>
                  )}
                </span>
                {d.entity?.id === r.id ? <Badge tone="brand">{t('pro.wiz.entity.selected')}</Badge> : !r.promotable ? <Badge tone="gray">{t('pro.wiz.entity.notPromotable')}</Badge> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CommercialStep({ d, set, campaigns }: { d: Draft; set: (p: Partial<Draft>) => void; campaigns: PromotionCampaign[] }) {
  const { token, t } = useApp();
  const fixed = commercialFixed(d.type);
  const commercial = fixed ?? d.isCommercial;
  const [q, setQ] = useState('');
  const [partners, setPartners] = useState<PartnerMatch[]>([]);
  useEffect(() => {
    if (!token || !commercial) return;
    const h = setTimeout(async () => { try { setPartners((await api.searchPromotionPartners(token, q.trim())).items); } catch { setPartners([]); } }, 250);
    return () => clearTimeout(h);
  }, [token, q, commercial]);
  const rels = commercial ? COMMERCIAL_RELATIONSHIPS : NON_COMMERCIAL_RELATIONSHIPS;

  return (
    <div className="space-y-5">
      <h2 className="font-semibold">{t('pro.wiz.commercial.title')}</h2>
      {fixed === true && <Alert tone="info">{t('pro.wiz.commercial.sponsoredFixed')}</Alert>}
      {fixed === false && <Alert tone="info">{t('pro.wiz.commercial.recommendedFixed')}</Alert>}
      {fixed === null && (
        <div className="grid gap-2 sm:grid-cols-2">
          {[false, true].map(v => (
            <label key={String(v)} className={`flex cursor-pointer items-start gap-2 rounded-[var(--radius-md)] border p-3 text-sm ${d.isCommercial === v ? 'border-[var(--color-brand-600)] bg-[var(--color-brand-50)]' : 'border-[var(--color-border-secondary)]'}`}>
              <input type="radio" name="commercial" checked={d.isCommercial === v} data-testid={v ? 'commercial-yes' : 'commercial-no'}
                onChange={() => set({ isCommercial: v, relationshipType: v ? 'paid_advertising' : (d.type === 'campaign' ? 'campaign' : 'editorial') })} />
              <span><span className="font-medium">{v ? t('pro.wiz.commercial.yes') : t('pro.wiz.commercial.no')}</span><br />
                <span className="text-[var(--color-fg-tertiary)]">{v ? t('pro.wiz.commercial.yesHint') : t('pro.wiz.commercial.noHint')}</span></span>
            </label>
          ))}
        </div>
      )}
      <Field label={t('pro.wiz.commercial.relationship')}>
        <select className="ui-input" value={d.relationshipType} onChange={e => set({ relationshipType: e.target.value })} data-testid="wizard-relationship">
          {rels.map(r => <option key={r} value={r}>{t(REL_KEY[r])}</option>)}
        </select>
      </Field>
      {commercial && (
        <>
          <Field label={t('pro.wiz.commercial.partner')} hint={t('pro.wiz.commercial.partnerHint')}>
            <div className="space-y-2">
              {d.partner && (
                <p className="flex items-center justify-between rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] p-2 text-sm" data-testid="wizard-partner-selected">
                  <span>{d.partner.name}</span>
                  <button type="button" className="text-xs text-[var(--color-fg-tertiary)] hover:underline" onClick={() => set({ partner: null })}>{t('pro.wiz.commercial.clear')}</button>
                </p>
              )}
              <input className="ui-input" type="search" placeholder={t('pro.wiz.commercial.partnerSearch')} value={q} onChange={e => setQ(e.target.value)} data-testid="wizard-partner-search" />
              {partners.length > 0 && (
                <ul className="max-h-40 divide-y divide-[var(--color-border-secondary)] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border-secondary)]">
                  {partners.map(p => (
                    <li key={p.id}><button type="button" className="w-full p-2 text-left text-sm hover:bg-[var(--color-bg-secondary)]" onClick={() => { set({ partner: p }); setQ(''); }} data-testid={`partner-${p.id}`}>{p.name}</button></li>
                  ))}
                </ul>
              )}
            </div>
          </Field>
          <Field label={t('pro.wiz.commercial.reference')} hint={t('pro.wiz.commercial.referenceHint')}>
            <input className="ui-input" value={d.commercialRef} onChange={e => set({ commercialRef: e.target.value })} maxLength={200} data-testid="wizard-commercial-ref" />
          </Field>
        </>
      )}
      <Field label={d.type === 'campaign' ? t('pro.wiz.commercial.campaignRequired') : t('pro.wiz.commercial.campaign')}>
        <select className="ui-input" value={d.campaignId} onChange={e => set({ campaignId: e.target.value })} data-testid="wizard-campaign">
          <option value="">{t('pro.wiz.commercial.noCampaign')}</option>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label={t('pro.wiz.commercial.label')} hint={t('pro.wiz.commercial.labelHint')}>
        <input className="ui-input" value={d.disclosureLabel} onChange={e => set({ disclosureLabel: e.target.value })} maxLength={60} />
      </Field>
      <Field label={t('pro.wiz.commercial.notes')}>
        <textarea className="ui-input" rows={2} value={d.notes} onChange={e => set({ notes: e.target.value })} maxLength={1000} />
      </Field>
    </div>
  );
}

function ReviewStep({ d, body, areas, preview, previewError }: {
  d: Draft; body: PromotionInput | null; areas: GeoArea[]; preview: PromotionPreview | null; previewError: string | null;
}) {
  const { t } = useApp();
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid gap-1 py-2 sm:grid-cols-3"><dt className="text-sm text-[var(--color-fg-tertiary)]">{label}</dt><dd className="text-sm sm:col-span-2">{value}</dd></div>
  );
  if (!body || !d.entity || !d.type) return null;
  return (
    <div className="space-y-4">
      <h2 className="font-semibold">{t('pro.wiz.review.title')}</h2>
      <dl className="divide-y divide-[var(--color-border-secondary)]" data-testid="wizard-summary">
        {row(t('pro.wiz.step.entity'), <>{d.entity.name} <span className="text-[var(--color-fg-quaternary)]">· {t(ENTITY_TYPE_KEY[d.entity.entityType])}</span></>)}
        {row(t('pro.wiz.step.type'), t(TYPE_KEY[d.type]))}
        {row(t('pro.wiz.step.placement'), d.placements.map(p => t(PLACEMENT_KEY[p])).join(', '))}
        {row(t('pro.wiz.review.where'), scopeSummary(body.geoScope, areas, t('pro.everywhere')))}
        {row(t('pro.wiz.review.when'), `${dateTime(body.startsAt)} → ${dateTime(body.endsAt)}`)}
        {row(t('pro.wiz.step.priority'), `${body.priority} · ${t('pro.wiz.priority.weight')} ${body.boostWeight}`)}
        {row(t('pro.wiz.step.commercial'), body.isCommercial
          ? <>{t('pro.wiz.commercial.yes')} · {t(REL_KEY[body.relationshipType ?? 'paid_advertising'])}{d.partner ? ` · ${d.partner.name}` : ''}{body.commercialRef ? ` · ${body.commercialRef}` : ''}</>
          : t('pro.wiz.commercial.no'))}
      </dl>
      {previewError && <Alert tone="error">{previewError}</Alert>}
      {!preview && !previewError && <Spinner className="h-5 w-5" />}
      {preview && (
        <div className="space-y-3" data-testid="wizard-preview">
          {preview.eligibility.ok
            ? <Alert tone="success">{t('pro.wiz.review.eligible')}</Alert>
            : <Alert tone="error">{t('pro.wiz.review.notEligible')} {preview.eligibility.reasons.map(c => { const k = whyKey(c); return k ? t(k) : c; }).join('; ')}</Alert>}
          <CapacityList rows={preview.capacity} />
          {preview.capacity.some(c => c.full) && <Alert tone="warning">{t('pro.wiz.review.full')}</Alert>}
        </div>
      )}
    </div>
  );
}

export function CapacityList({ rows }: { rows: CapacityRow[] }) {
  const { t } = useApp();
  return (
    <ul className="space-y-1 text-sm" data-testid="capacity-list">
      {rows.map(c => (
        <li key={`${c.placement}:${c.type}`} className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] px-3 py-2">
          <span>{t(PLACEMENT_KEY[c.placement])}</span>
          <span className="flex items-center gap-2 tabular-nums">{c.used} / {c.max}<Badge tone={c.full ? 'danger' : 'success'}>{c.full ? t('pro.capacity.full') : t('pro.capacity.room')}</Badge></span>
        </li>
      ))}
    </ul>
  );
}
