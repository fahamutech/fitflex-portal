'use client';
// Steps 4 to 6: check (counts and rows), confirm (apply loop with progress) and result (counts, report, retry, discard).
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { fmt } from '@/lib/vendor';
import {
  apiCode, driveApply, eligibleCount, errorText, importApi, type ApplyOutcome, type ImportBatch, type ImportCounts,
} from '@/lib/vendor-import';
import { Alert, Checkbox, Stat } from '@/components/shared';
import { ConfirmDialog } from '@/components/dialog';
import { ErrorsDownload, ProgressBar, StepHeading, linkBtnCls, primaryLinkCls, Btn } from './parts';
import { RowsList } from './rows-list';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../../../app/providers';

const rowsVersion = (b: ImportBatch) => `${b.status}|${b.updatedAt}|${b.counts?.applied ?? 0}|${b.counts?.failed ?? 0}`;
const problemsOf = (c: ImportCounts | null) => (c ? c.invalid + c.needs_review : 0);

function CountsGrid({ counts, keys }: { counts: ImportCounts; keys: Array<'valid' | 'needs_review' | 'invalid' | 'total'> }) {
  const { t } = useApp();
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="group" aria-label={t('vendor.import.check.countsLabel')} data-testid="import-counts">
      {keys.map(k => <Stat key={k} label={t(`vendor.import.count.${k}` as 'vendor.import.count.valid')} value={counts[k]} />)}
    </div>
  );
}

// ── Step 4: check ──
export function CheckStep({ batch, readOnly, onColumns, onNext, onDiscard }: {
  batch: ImportBatch; readOnly: boolean; onColumns: () => void; onNext: () => void; onDiscard: () => void;
}) {
  const { t } = useApp();
  const c = batch.counts;
  return (
    <section aria-labelledby="import-check-title" className="space-y-4" data-testid="import-check">
      <StepHeading id="import-check-title" hint={t('vendor.import.check.body')}>{t('vendor.import.check.title')}</StepHeading>
      {c && <CountsGrid counts={c} keys={['valid', 'needs_review', 'invalid', 'total']} />}
      {c && c.valid === 0 && c.needs_review === 0 && <Alert tone="warning">{t('vendor.import.check.nothingReady')}</Alert>}
      {c && problemsOf(c) > 0 && <ErrorsDownload batchId={batch.id} variant="ghost" />}
      <RowsList batchId={batch.id} counts={c} version={rowsVersion(batch)} />
      {!readOnly && (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Btn variant="secondary" onClick={onColumns} className="max-sm:w-full" data-testid="import-edit-columns">{t('vendor.import.check.editColumns')}</Btn>
          <Btn onClick={onNext} disabled={!c || (c.valid + c.needs_review) === 0} className="max-sm:w-full" data-testid="import-check-next">{t('vendor.import.check.next')}</Btn>
          <Btn variant="ghost" onClick={onDiscard} className="max-sm:w-full" data-testid="import-discard">{t('vendor.import.discard')}</Btn>
        </div>
      )}
    </section>
  );
}

// ── The apply loop, shared by the confirm step and "retry failed rows" ──
type Pause = 'busy' | 'rate' | 'network';
/**
 * `onPin(true)` while a run is under way: the page keeps showing this step even though the batch's status moves
 * (ready between calls), so the step is not swapped out mid-loop.
 */
export function useApplyRunner(batch: ImportBatch, onBatch: (b: ImportBatch) => void, include: boolean, onPin: (on: boolean) => void) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const [running, setRunning] = useState(false);
  const [pause, setPause] = useState<Pause | null>(null);
  const [error, setError] = useState<{ code: string | null; text: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onPin(running); }, [running, onPin]);

  const run = useCallback(async (first: 'apply' | 'retry') => {
    if (!token) return;
    setRunning(true); setPause(null); setError(null);
    const outcome: ApplyOutcome = await driveApply({
      token, id: batch.id, includeNeedsReview: include, first,
      onProgress: b => { if (alive.current) onBatch(b); },
      shouldStop: () => !alive.current,
    });
    if (!alive.current) return;
    setRunning(false);
    if (outcome.kind === 'done') onBatch(outcome.batch);
    else if (outcome.kind === 'paused') { if (outcome.batch) onBatch(outcome.batch); setPause(outcome.reason); }
    else if (!vendor.handleError(outcome.error)) {
      setError({ code: apiCode(outcome.error), text: errorText(outcome.error, locale, t) });
      // Whatever the refusal, show the batch as the server has it now.
      const fresh = await importApi.get(token, batch.id).catch(() => null);
      if (fresh && alive.current) onBatch(fresh.batch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, batch.id, include, locale]);
  return { running, pause, error, run };
}

function RunStatus({ batch, include, running, pause, error }: { batch: ImportBatch; include: boolean; running: boolean; pause: Pause | null; error: { text: string } | null }) {
  const { t } = useApp();
  const c = batch.counts;
  const total = eligibleCount(c, include);
  const done = c ? c.applied + c.failed : 0;
  return (
    <div className="space-y-3" aria-live="polite">
      {running && c && (
        <div className="space-y-2" data-testid="import-progress">
          <p className="text-sm font-medium text-[var(--color-fg-primary)]">{fmt(t('vendor.import.confirm.progress'), { done: Math.min(done, total), total })}</p>
          <ProgressBar done={done} total={total} label={t('vendor.import.confirm.progressLabel')} />
          <p className="text-sm text-[var(--color-fg-quaternary)]">{t('vendor.import.confirm.keepOpen')}</p>
        </div>
      )}
      {pause && <Alert tone="info">{t(`vendor.import.paused.${pause}` as 'vendor.import.paused.busy')}</Alert>}
      {error && <Alert tone="error" className="[overflow-wrap:anywhere]">{error.text}</Alert>}
    </div>
  );
}

// ── Step 5: confirm ──
export function ConfirmStep({ batch, readOnly, onBatch, onPin, onBack, onDiscard }: {
  batch: ImportBatch; readOnly: boolean; onBatch: (b: ImportBatch) => void; onPin: (on: boolean) => void; onBack: () => void; onDiscard: () => void;
}) {
  const { t } = useApp();
  const c = batch.counts;
  const fixed = batch.includeNeedsReview !== null;
  const [choice, setChoice] = useState(false);
  const include = fixed ? batch.includeNeedsReview === true : choice;
  const { running, pause, error, run } = useApplyRunner(batch, onBatch, include, onPin);
  const resuming = batch.status === 'applying';
  const n = eligibleCount(c, include);
  const note = batch.entity === 'products' ? 'vendor.import.confirm.products' : batch.entity === 'inventory' ? 'vendor.import.confirm.inventory' : 'vendor.import.confirm.profile';
  const busy = running;
  return (
    <section aria-labelledby="import-confirm-title" className="space-y-4" aria-busy={busy} data-testid="import-confirm">
      <StepHeading id="import-confirm-title">{t('vendor.import.confirm.title')}</StepHeading>
      {c && <p className="text-sm font-medium text-[var(--color-fg-primary)]" data-testid="import-confirm-summary">{fmt(t('vendor.import.confirm.summary'), { n })}</p>}
      {c && c.needs_review > 0 && !resuming && (
        fixed ? (
          <p className="text-sm text-[var(--color-fg-secondary)]">{t(include ? 'vendor.import.confirm.includeFixed' : 'vendor.import.confirm.excludeFixed')}</p>
        ) : (
          <Checkbox
            label={fmt(t('vendor.import.confirm.includeReview'), { n: c.needs_review })}
            description={t('vendor.import.confirm.includeReviewHint')}
            checked={choice}
            disabled={busy || readOnly}
            onChange={e => setChoice(e.target.checked)}
            data-testid="import-include-review"
          />
        )
      )}
      <Alert tone="info" className="[overflow-wrap:anywhere]">{t(note)}</Alert>
      {resuming && !running && <Alert tone="info">{t('vendor.import.confirm.resume')}</Alert>}
      <RunStatus batch={batch} include={include} running={running} pause={pause} error={error} />
      {!readOnly && (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {!resuming && <Btn variant="secondary" onClick={onBack} disabled={busy} className="max-sm:w-full">{t('vendor.import.back')}</Btn>}
          <Btn onClick={() => run('apply')} loading={busy} disabled={!resuming && n === 0} className="max-sm:w-full" data-testid="import-apply">
            {busy ? t('vendor.import.confirm.starting') : resuming || pause ? t('vendor.import.confirm.continue') : fmt(t('vendor.import.confirm.start'), { n })}
          </Btn>
          {!resuming && !busy && <Btn variant="ghost" onClick={onDiscard} className="max-sm:w-full">{t('vendor.import.discard')}</Btn>}
        </div>
      )}
    </section>
  );
}

// ── Step 6: result ──
export function ResultStep({ batch, readOnly, onBatch, onPin }: { batch: ImportBatch; readOnly: boolean; onBatch: (b: ImportBatch) => void; onPin: (on: boolean) => void }) {
  const { t } = useApp();
  const c = batch.counts;
  const include = batch.includeNeedsReview === true;
  const { running, pause, error, run } = useApplyRunner(batch, onBatch, include, onPin);
  const failed = c?.failed ?? 0;
  const expired = error?.code === 'batch_expired';
  const issues = c ? c.invalid + c.failed + (include ? 0 : c.needs_review) : 0;
  const note = batch.entity === 'products' ? 'vendor.import.result.products' : batch.entity === 'inventory' ? 'vendor.import.result.inventory' : 'vendor.import.result.profile';
  return (
    <section aria-labelledby="import-result-title" className="space-y-4" aria-busy={running} data-testid="import-result">
      <StepHeading id="import-result-title">{t(batch.status === 'applied' ? 'vendor.import.result.applied' : 'vendor.import.result.partial')}</StepHeading>
      {c && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="import-result-counts">
          <Stat label={t('vendor.import.result.imported')} value={c.applied} />
          <Stat label={t('vendor.import.result.failed')} value={c.failed} />
          <Stat label={t('vendor.import.result.notImported')} value={c.invalid + (include ? 0 : c.needs_review)} />
          <Stat label={t('vendor.import.result.skipped')} value={c.skipped} />
        </div>
      )}
      <Alert tone={batch.entity === 'products' ? 'warning' : 'info'} className="[overflow-wrap:anywhere]" >{t(note)}</Alert>
      <RunStatus batch={batch} include={include} running={running} pause={pause} error={expired ? null : error} />
      {expired && (
        <Alert tone="warning" className="[overflow-wrap:anywhere]">
          <strong className="block">{t('vendor.import.expired.title')}</strong>{error?.text}
        </Alert>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {batch.entity !== 'profile' && <Link href="/vendor/products/" className={primaryLinkCls} data-testid="import-to-products">{t('vendor.import.result.viewProducts')}</Link>}
        {!readOnly && batch.status === 'partial' && failed > 0 && !expired && (
          <Btn variant="secondary" onClick={() => run('retry')} loading={running} className="max-sm:w-full" data-testid="import-retry">{t('vendor.import.result.retry')}</Btn>
        )}
        {issues > 0 && <ErrorsDownload batchId={batch.id} />}
        <Link href="/vendor/import/new/" className={linkBtnCls}>{t('vendor.import.result.newImport')}</Link>
        <Link href="/vendor/import/" className={linkBtnCls}>{t('vendor.import.backToList')}</Link>
      </div>
      {issues > 0 && (
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-[var(--color-fg-primary)]">{t('vendor.import.result.rowsTitle')}</h3>
          <RowsList batchId={batch.id} counts={c} showApplyState version={rowsVersion(batch)} />
        </div>
      )}
    </section>
  );
}

// ── Discard (shared dialog) ──
export function DiscardDialog({ batch, open, onClose, onDiscarded, onStale }: {
  batch: ImportBatch; open: boolean; onClose: () => void; onDiscarded: (b: ImportBatch) => void; onStale: () => void;
}) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    if (!token) return;
    setBusy(true); setError(null);
    try {
      const { batch: out } = await importApi.discard(token, batch.id);
      onDiscarded(out);
    } catch (err) {
      if (vendor.handleError(err)) return;
      setError(errorText(err, locale, t));
      if (apiCode(err) === 'not_discardable') onStale();
    } finally { setBusy(false); }
  };
  return (
    <ConfirmDialog
        open={open}
        onClose={() => { setError(null); onClose(); }}
        onConfirm={confirm}
        busy={busy}
        title={t('vendor.import.discard.title')}
        description={error ? `${t('vendor.import.discard.body')} ${error}` : t('vendor.import.discard.body')}
        confirmLabel={t('vendor.import.discard.confirm')}
        cancelLabel={t('vendor.import.discard.cancel')}
      />
  );
}
