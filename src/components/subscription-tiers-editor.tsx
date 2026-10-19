'use client';
import { Dispatch, SetStateAction } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../app/providers';
import { SubscriptionTierConfig } from '@/lib/api';
import { Badge, Button, Checkbox, Input, Select, Table, TBody, Td, Th, THead, Tr } from '@/components/shared';
import { money, currencyLabel } from '@/lib/admin-utils';
import {
  GYM_ACCESS_LABEL, GYM_ACCESS_VALUES, TierField, UNLIMITED_VISITS, fillIn, gymAccessValid, tierErrors, tierStatus,
} from '@/lib/pass-tiers';

/** A new tier starts with nothing set, so it can't be saved until price, visits and gyms are chosen. */
const newTier = (label: string): SubscriptionTierConfig => ({ key: `tier_${Date.now()}`, label, monthlyPrice: 0, visits: null, gymAccess: '' });

/** True when every tier can be saved (see tierErrors). */
export const tiersSavable = (tiers: SubscriptionTierConfig[]) => tiers.every(t => Object.keys(tierErrors(t, tiers)).length === 0);

const wholeOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

/**
 * The FitFlex Pass tiers in Settings. Settings is the only price source (fitflex-functions#189):
 * each row shows whether it is on sale, and why not, before the admin saves.
 */
export function SubscriptionTiersEditor({ tiers, setTiers, currency }: {
  tiers: SubscriptionTierConfig[];
  setTiers: Dispatch<SetStateAction<SubscriptionTierConfig[]>>;
  currency: string;
}) {
  const { t } = useApp();
  const update = (idx: number, patch: Partial<SubscriptionTierConfig>) =>
    setTiers(prev => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  const visitsText = (v: number | null) =>
    Number(v) === UNLIMITED_VISITS ? t('tiers.visitsUnlimited') : v == null || String(v) === '' ? '—' : fillIn(t('tiers.visitsCount'), { n: v });

  return (
    <div className="space-y-4" data-testid="tiers-editor">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t('admin.settings.subscriptionTiers')}</h3>
        <Button variant="ghost" size="sm" onClick={() => setTiers(prev => [...prev, newTier(t('tiers.newLabel'))])} data-testid="tier-add">
          <Plus className="h-3.5 w-3.5" /> {t('admin.settings.addTier')}
        </Button>
      </div>
      <p className="text-xs text-[var(--color-fg-quaternary)]">{t('tiers.intro')}</p>
      <Table aria-label={t('admin.settings.subscriptionTiers')}>
        <THead>
          <Tr>
            <Th>{t('tiers.col.key')}</Th>
            <Th>{t('tiers.col.label')}</Th>
            <Th className="!text-right">{fillIn(t('tiers.col.price'), { currency: currencyLabel(currency) })}</Th>
            <Th>{t('tiers.col.visits')}</Th>
            <Th>{t('tiers.col.gymAccess')}</Th>
            <Th>{t('tiers.col.status')}</Th>
            <Th className="w-10"><span className="sr-only">{t('tiers.remove')}</span></Th>
          </Tr>
        </THead>
        <TBody>
          {tiers.map((row, i) => {
            const errs = tierErrors(row, tiers);
            const status = tierStatus(row);
            const unlimited = Number(row.visits) === UNLIMITED_VISITS;
            const err = (f: TierField) => errs[f] && (
              <p className="mt-1 text-xs text-[var(--color-error-700)]" data-testid={`tier-${i}-error-${f}`}>{t(errs[f]!)}</p>
            );
            return (
              <Tr key={i} data-testid={`tier-row-${i}`}>
                <Td>
                  <Input size="sm" className="font-mono" aria-label={t('tiers.col.key')} aria-invalid={!!errs.key} value={row.key} onChange={e => update(i, { key: e.target.value })} />
                  {err('key')}
                </Td>
                <Td>
                  <Input size="sm" aria-label={t('tiers.col.label')} value={row.label} onChange={e => update(i, { label: e.target.value })} />
                </Td>
                <Td>
                  <Input size="sm" className="text-right font-mono tabular-nums" type="number" min={0} step={1}
                    aria-label={fillIn(t('tiers.col.price'), { currency: currencyLabel(currency) })} aria-invalid={!!errs.monthlyPrice}
                    value={Number.isFinite(Number(row.monthlyPrice)) ? row.monthlyPrice : ''}
                    onChange={e => update(i, { monthlyPrice: e.target.value === '' ? NaN : Number(e.target.value) })}
                    data-testid={`tier-${i}-price`} />
                  {err('monthlyPrice')}
                </Td>
                <Td>
                  <div className="flex items-center gap-3">
                    {!unlimited && (
                      <Input size="sm" className="w-24 text-right font-mono tabular-nums" type="number" min={1} step={1}
                        aria-label={t('tiers.col.visits')} aria-invalid={!!errs.visits}
                        value={row.visits ?? ''} onChange={e => update(i, { visits: wholeOrNull(e.target.value) })}
                        data-testid={`tier-${i}-visits`} />
                    )}
                    <Checkbox label={t('tiers.unlimited')} checked={unlimited}
                      onChange={e => update(i, { visits: e.target.checked ? UNLIMITED_VISITS : null })}
                      data-testid={`tier-${i}-unlimited`} />
                  </div>
                  {err('visits')}
                </Td>
                <Td>
                  <Select size="sm" aria-label={t('tiers.col.gymAccess')} aria-invalid={!!errs.gymAccess}
                    value={gymAccessValid(row.gymAccess) ? row.gymAccess : ''} onChange={e => update(i, { gymAccess: e.target.value })}
                    data-testid={`tier-${i}-gym-access`}>
                    {!gymAccessValid(row.gymAccess) && <option value="">{t('tiers.gymAccess.choose')}</option>}
                    {GYM_ACCESS_VALUES.map(v => <option key={v} value={v}>{t(GYM_ACCESS_LABEL[v])}</option>)}
                  </Select>
                  {err('gymAccess')}
                </Td>
                <Td data-testid={`tier-${i}-status`}>
                  <Badge tone={status.tone} dot>{t(status.key)}</Badge>
                </Td>
                <Td>
                  <Button variant="ghost" size="sm" aria-label={t('tiers.remove')} onClick={() => setTiers(prev => prev.filter((_, idx) => idx !== i))}>
                    <Trash2 className="h-3.5 w-3.5 text-[var(--color-error-600)]" />
                  </Button>
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
      {tiers.length > 0 && (
        <div className="flex flex-wrap gap-3 mt-2">
          {tiers.map((row, i) => (
            <div key={i} className="rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3 text-center min-w-[120px]">
              <p className="text-xs text-[var(--color-fg-quaternary)]">{row.label}</p>
              <p className="text-lg font-bold tabular-nums">{money(Number.isFinite(Number(row.monthlyPrice)) ? Number(row.monthlyPrice) : 0)}</p>
              <p className="text-xs text-[var(--color-fg-quaternary)]">{visitsText(row.visits)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
