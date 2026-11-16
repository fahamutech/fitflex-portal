'use client';
import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Alert, Badge, Button, EmptyState, Field, Input, Select, Spinner, Table, TBody, Td, Textarea, Th, THead, Tr } from './shared';
import { Dialog, DialogFooter } from './dialog';
import { FailureView, useFailureText, useGymPassFormat } from './gym-pass-shared';
import { fill } from './communication-shared';
import { money } from '@/lib/admin-utils';
import { classifyGymPassError, gymPassesApi, wholeNumber, type DurationUnit, type GymPassFailure, type PassCategory, type PassPlan } from '@/lib/gym-passes';
import { useApp } from '../../app/providers';

const CATEGORIES: PassCategory[] = ['individual', 'couples', 'group'];
const UNITS: DurationUnit[] = ['days', 'weeks', 'months'];

interface Draft { name: string; description: string; category: PassCategory; groupLimit: string; durationValue: string; durationUnit: DurationUnit; price: string; terms: string; publishNow: boolean }
const blank: Draft = { name: '', description: '', category: 'individual', groupLimit: '3', durationValue: '1', durationUnit: 'months', price: '', terms: '', publishNow: false };
const draftOf = (p: PassPlan): Draft => ({
  name: p.name, description: p.description ?? '', category: p.category, groupLimit: p.category === 'group' ? String(p.beneficiaryLimit) : '3',
  durationValue: String(p.durationValue), durationUnit: p.durationUnit, price: String(p.priceTzs), terms: p.terms ?? '', publishNow: false,
});

/** Owner (scope gyms): design, publish, unpublish and edit custom passes. */
export function GymPassPlans({ gymId, onChanged }: { gymId: string; onChanged: () => void }) {
  const { token, t } = useApp();
  const fmtr = useGymPassFormat();
  const failureText = useFailureText();
  const [plans, setPlans] = useState<PassPlan[] | null>(null);
  const [failure, setFailure] = useState<GymPassFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<PassPlan | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ plan: PassPlan; to: 'active' | 'inactive' } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setFailure(null);
    try { setPlans((await gymPassesApi.plans(token, gymId)).plans); }
    catch (e) { setPlans([]); setFailure(classifyGymPassError(e)); }
  }, [token, gymId]);
  useEffect(() => { setPlans(null); void load(); }, [load]);

  const open = (p: PassPlan | 'new') => { setEditing(p); setDraft(p === 'new' ? blank : draftOf(p)); setFormError(null); setNotice(null); };

  async function save() {
    if (!token || !editing) return;
    const durationValue = wholeNumber(draft.durationValue);
    const priceTzs = wholeNumber(draft.price);
    const limit = draft.category === 'individual' ? 1 : draft.category === 'couples' ? 2 : wholeNumber(draft.groupLimit);
    if (durationValue == null || priceTzs == null || limit == null) { setFormError(t('gp.generic')); return; }
    const input = {
      name: draft.name.trim(), description: draft.description.trim() || null, category: draft.category, durationValue,
      durationUnit: draft.durationUnit, beneficiaryLimit: limit, priceTzs, terms: draft.terms.trim() || null,
    };
    setBusy(true); setFormError(null);
    try {
      if (editing === 'new') { await gymPassesApi.createPlan(token, gymId, { ...input, status: draft.publishNow ? 'active' : 'inactive' }); setNotice(t('gp.plan.created')); }
      else { await gymPassesApi.updatePlan(token, gymId, editing.id, input); setNotice(t('gp.plan.saved')); }
      setEditing(null);
      await load(); onChanged();
    } catch (e) {
      const f = classifyGymPassError(e);
      if (f.kind === 'disabled') { setEditing(null); setFailure(f); } else setFormError(failureText(f));
    } finally { setBusy(false); }
  }

  async function flip() {
    if (!token || !confirm) return;
    setBusy(true);
    try {
      await gymPassesApi.setPlanStatus(token, gymId, confirm.plan.id, confirm.to);
      setNotice(t(confirm.to === 'active' ? 'gp.plan.published' : 'gp.plan.unpublished'));
      setConfirm(null);
      await load(); onChanged();
    } catch (e) {
      setConfirm(null);
      setFailure(classifyGymPassError(e));
    } finally { setBusy(false); }
  }

  if (failure?.kind === 'disabled') return <FailureView failure={failure} />;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => ({ ...d, [k]: v }));

  return (
    <div className="space-y-4" data-testid="gp-plans">
      <div className="flex justify-end">
        <Button variant="primary" size="md" onClick={() => open('new')} data-testid="gp-plan-new"><Plus aria-hidden="true" className="mr-1.5 h-4 w-4" />{t('gp.plans.new')}</Button>
      </div>
      {notice && <Alert tone="success">{notice}</Alert>}
      {failure && <FailureView failure={failure} onRetry={load} />}
      {plans == null ? <Spinner className="h-6 w-6" /> : plans.length === 0 ? (!failure && <EmptyState title={t('gp.plans.empty')} body={t('gp.plans.emptyBody')} />) : (
        <Table aria-label={t('gp.plans.table')}>
          <THead>
            <Tr>
              <Th>{t('gp.plans.col.name')}</Th><Th>{t('gp.plans.col.type')}</Th><Th>{t('gp.plans.col.length')}</Th><Th>{t('gp.plans.col.people')}</Th>
              <Th>{t('gp.plans.col.price')}</Th><Th>{t('gp.plans.col.status')}</Th><Th>{t('gp.plans.col.actions')}</Th>
            </Tr>
          </THead>
          <TBody>
            {plans.map(p => (
              <Tr key={p.id} data-testid={`gp-plan-${p.id}`}>
                <Td><div className="font-medium">{p.name}</div>{p.description && <div className="max-w-xs truncate text-xs text-[var(--color-fg-quaternary)]" title={p.description}>{p.description}</div>}</Td>
                <Td>{t(`gp.category.${p.category}`)}</Td>
                <Td>{fmtr.duration(p.durationValue, p.durationUnit)}</Td>
                <Td>{fmtr.people(p.category, p.beneficiaryLimit)}</Td>
                <Td className="whitespace-nowrap tabular-nums">{money(p.priceTzs, p.currency)}</Td>
                <Td><Badge tone={p.status === 'active' ? 'success' : 'gray'}>{t(`gp.plan.status.${p.status}`)}</Badge></Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    <Button variant="ghost" size="sm" onClick={() => open(p)} data-testid="gp-plan-edit">{t('gp.plan.edit')}</Button>
                    {p.status === 'active'
                      ? <Button variant="ghost" size="sm" onClick={() => setConfirm({ plan: p, to: 'inactive' })} data-testid="gp-plan-unpublish">{t('gp.plan.unpublish')}</Button>
                      : <Button variant="ghost" size="sm" onClick={() => setConfirm({ plan: p, to: 'active' })} data-testid="gp-plan-publish">{t('gp.plan.publish')}</Button>}
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      <Dialog open={!!editing} onClose={() => !busy && setEditing(null)} size="lg" testId="gp-plan-dialog"
        title={t(editing === 'new' ? 'gp.form.createTitle' : 'gp.form.editTitle')}
        description={editing && editing !== 'new' ? t('gp.plan.boughtNote') : undefined}>
        <div className="space-y-4">
          {formError && <Alert tone="error">{formError}</Alert>}
          <Field label={t('gp.form.name')} hint={t('gp.form.nameHint')} required>
            <Input value={draft.name} maxLength={80} onChange={e => set('name', e.target.value)} data-testid="gp-form-name" />
          </Field>
          <Field label={t('gp.form.description')} hint={t('gp.form.descriptionHint')}>
            <Textarea value={draft.description} maxLength={500} rows={2} onChange={e => set('description', e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('gp.form.category')} required>
              <Select value={draft.category} onChange={e => set('category', e.target.value as PassCategory)} data-testid="gp-form-category">
                {CATEGORIES.map(c => <option key={c} value={c}>{t(`gp.category.${c}`)}</option>)}
              </Select>
            </Field>
            {draft.category === 'group' && (
              <Field label={t('gp.form.groupLimit')} hint={t('gp.form.groupLimitHint')} required>
                <Input inputMode="numeric" value={draft.groupLimit} onChange={e => set('groupLimit', e.target.value.replace(/[^0-9]/g, ''))} data-testid="gp-form-limit" />
              </Field>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('gp.form.durationValue')} hint={t('gp.form.durationHint')} required>
              <Input inputMode="numeric" value={draft.durationValue} onChange={e => set('durationValue', e.target.value.replace(/[^0-9]/g, ''))} data-testid="gp-form-duration" />
            </Field>
            <Field label={t('gp.form.durationUnit')} required>
              <Select value={draft.durationUnit} onChange={e => set('durationUnit', e.target.value as DurationUnit)} data-testid="gp-form-unit">
                {UNITS.map(u => <option key={u} value={u}>{t(`gp.unit.${u}`)}</option>)}
              </Select>
            </Field>
          </div>
          <Field label={t('gp.form.price')} hint={t('gp.form.priceHint')} required>
            <Input inputMode="numeric" value={draft.price} onChange={e => set('price', e.target.value.replace(/[^0-9]/g, ''))} data-testid="gp-form-price" />
          </Field>
          <Field label={t('gp.form.terms')} hint={t('gp.form.termsHint')}>
            <Textarea value={draft.terms} maxLength={4000} rows={3} onChange={e => set('terms', e.target.value)} />
          </Field>
          {editing === 'new' && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.publishNow} onChange={e => set('publishNow', e.target.checked)} data-testid="gp-form-publish" />
              {t('gp.form.publishNow')}
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setEditing(null)} disabled={busy}>{t('gp.form.cancel')}</Button>
          <Button variant="primary" size="md" onClick={save} disabled={busy || draft.name.trim().length < 2} data-testid="gp-form-save">
            {busy ? t('gp.form.saving') : t(editing === 'new' ? 'gp.form.create' : 'gp.form.save')}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={!!confirm} onClose={() => !busy && setConfirm(null)} size="sm" testId="gp-plan-confirm"
        title={confirm ? t(confirm.to === 'active' ? 'gp.plan.publishConfirmTitle' : 'gp.plan.unpublishConfirmTitle') : ''}
        description={confirm ? fill(t(confirm.to === 'active' ? 'gp.plan.publishConfirmBody' : 'gp.plan.unpublishConfirmBody'), { name: confirm.plan.name }) : ''}>
        <DialogFooter>
          <Button variant="secondary" size="md" onClick={() => setConfirm(null)} disabled={busy}>{t('gp.person.cancel')}</Button>
          <Button variant="primary" size="md" onClick={flip} disabled={busy} data-testid="gp-plan-confirm-yes">{busy ? t('gp.person.working') : t('gp.person.confirm')}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
