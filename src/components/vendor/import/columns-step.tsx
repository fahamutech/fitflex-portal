'use client';
// Step 3: the detected columns, the suggested field for each (and how sure the match is), samples, and the vendor's
// confirmation of every non-exact critical match. Saves with PUT /mapping { mapping, confirm: true }.
import { useState } from 'react';
import { fmt } from '@/lib/vendor';
import {
  ENTITY_FIELDS, REQUIRED_FIELDS, apiBody, apiCode, draftsOf, errorText, fieldKey, importApi, mappingBody, mappingProblem, matchKey, matchTone,
  needsTick, type ColumnDraft, type ImportBatch, type ImportColumn,
} from '@/lib/vendor-import';
import { Alert, Badge, Checkbox, Field, Select } from '@/components/shared';
import { StepHeading, Btn } from './parts';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../../../app/providers';

export function ColumnsStep({ batch, columns, onSaved, onCancel, onStale }: {
  batch: ImportBatch;
  columns: ImportColumn[];
  onSaved: (batch: ImportBatch) => void;
  /** Only when the batch is already ready: leave without changing anything. */
  onCancel?: () => void;
  /** The batch can no longer be edited: reload it. */
  onStale: () => void;
}) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const entity = batch.entity;
  const [drafts, setDrafts] = useState<ColumnDraft[]>(() => draftsOf(columns));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showProblem, setShowProblem] = useState(false);
  const costAllowed = vendor.me?.tools?.canSeeCost !== false;

  const problem = mappingProblem(entity, drafts);
  const fieldName = (f: string) => t(fieldKey(f));
  const problemText = !problem ? null
    : problem.kind === 'missing' ? fmt(t('vendor.import.columns.problem.missing'), { fields: problem.fields.map(fieldName).join(', ') })
    : problem.kind === 'duplicate' ? fmt(t('vendor.import.columns.problem.duplicate'), { field: fieldName(problem.field) })
    : problem.kind === 'none' ? t('vendor.import.columns.problem.none')
    : t('vendor.import.columns.problem.confirm');

  const change = (source: string, patch: Partial<ColumnDraft>) => { setDrafts(cur => cur.map(d => (d.source === source ? { ...d, ...patch } : d))); setError(null); };

  const save = async () => {
    if (!token || busy) return;
    if (problem) { setShowProblem(true); return; }
    setBusy(true); setError(null);
    try {
      const { batch: saved } = await importApi.putMapping(token, batch.id, mappingBody(drafts));
      onSaved(saved);
    } catch (err) {
      if (vendor.handleError(err)) return;
      const code = apiCode(err);
      if (code === 'batch_not_editable') { setError(errorText(err, locale, t)); onStale(); }
      else if (code === 'mapping_confirmation_required') {
        // The server wants a confirmation we did not ask for (e.g. its view of a match changed): show which columns.
        const cols = (apiBody<{ columns?: Array<{ source: string }> }>(err)?.columns ?? []).map(c => c.source);
        setDrafts(cur => cur.map(d => (cols.includes(d.source) ? { ...d, confirmed: false, initialField: d.field, ticked: false } : d)));
        setShowProblem(true);
        setError(errorText(err, locale, t));
      } else setError(errorText(err, locale, t));
    } finally { setBusy(false); }
  };

  return (
    <section aria-labelledby="import-columns-title" className="space-y-4" aria-busy={busy} data-testid="import-columns">
      <StepHeading id="import-columns-title" hint={t('vendor.import.columns.body')}>{t('vendor.import.columns.title')}</StepHeading>
      <p className="text-sm text-[var(--color-fg-secondary)] [overflow-wrap:anywhere]">{fmt(t('vendor.import.columns.found'), { n: drafts.length, name: batch.filename })}</p>
      <ul className="space-y-3">
        {drafts.map(d => {
          const tick = needsTick(entity, d);
          const options = ENTITY_FIELDS[entity].filter(f => f !== 'cost_tzs' || costAllowed || d.field === f);
          return (
            <li key={d.source} className="rounded-[var(--radius-xl)] border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] p-3 sm:p-4" data-testid="import-column" data-source={d.source}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-[var(--color-fg-primary)] [overflow-wrap:anywhere]">{d.source}</span>
                {d.field && d.field === d.initialField && <Badge tone={matchTone(d.match)}>{t(matchKey(d.match))}</Badge>}
                {tick && !d.ticked && <Badge tone="warning">{t('vendor.import.columns.checkMatch')}</Badge>}
              </div>
              <p className="mt-1 text-sm text-[var(--color-fg-quaternary)] [overflow-wrap:anywhere]">
                {t('vendor.import.columns.samples')}: {d.sample.length ? d.sample.slice(0, 3).join(' · ') : t('vendor.import.columns.noSamples')}
              </p>
              <div className="mt-3">
                <Field label={fmt(t('vendor.import.columns.field'), { name: d.source })}>
                  <Select
                    value={d.field ?? ''}
                    onChange={e => change(d.source, { field: e.target.value || null, ticked: false })}
                    data-testid="import-column-field"
                  >
                    <option value="">{t('vendor.import.columns.skip')}</option>
                    {options.map(f => (
                      <option key={f} value={f}>
                        {fieldName(f)}{REQUIRED_FIELDS[entity].includes(f) ? ` (${t('vendor.import.columns.required')})` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {tick && (
                <Checkbox
                  label={fmt(t('vendor.import.columns.confirm'), { name: d.source })}
                  checked={d.ticked}
                  onChange={e => change(d.source, { ticked: e.target.checked })}
                  data-testid="import-column-confirm"
                />
              )}
            </li>
          );
        })}
      </ul>
      {showProblem && problemText && <Alert tone="warning" className="[overflow-wrap:anywhere]">{problemText}</Alert>}
      {error && <Alert tone="error" className="[overflow-wrap:anywhere]">{error}</Alert>}
      <div className="flex flex-col gap-3 sm:flex-row">
        {onCancel && <Btn variant="secondary" onClick={onCancel} disabled={busy} className="max-sm:w-full">{t('vendor.import.back')}</Btn>}
        <Btn onClick={save} loading={busy} className="max-sm:w-full" data-testid="import-columns-save">
          {busy ? t('vendor.import.columns.saving') : t('vendor.import.columns.save')}
        </Btn>
      </div>
    </section>
  );
}
