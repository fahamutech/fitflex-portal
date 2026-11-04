'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useFocusAfterRender } from '@/lib/use-focus-after-render';
import { apiCode, errorText, importApi, isAccountHolder, stepOfBatch, type ImportBatch, type ImportColumn, type ImportStep } from '@/lib/vendor-import';
import { Alert, ErrorState, PageHeader, SkeletonCard } from '@/components/shared';
import { BackLink, StatusBadge, Stepper, StepHeading, primaryLinkCls } from '@/components/vendor/import/parts';
import { ColumnsStep } from '@/components/vendor/import/columns-step';
import { CheckStep, ConfirmStep, DiscardDialog, ResultStep } from '@/components/vendor/import/apply-steps';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../../providers';

type State = 'loading' | 'ready' | 'notFound' | 'error';
type View = 'columns' | 'check' | 'confirm' | null;

/**
 * One import, read from ?id= (static export: no dynamic segment). Steps 3 to 6 of the wizard, driven by the batch's own
 * status: mapping_required → columns, ready → check / confirm (columns again on request), applying → confirm (resume),
 * applied | partial → result, discarded → a short note. The Shell guards the area (tools.import + `import`).
 */
function BatchInner() {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const id = useSearchParams().get('id') ?? '';
  const focusAfterRender = useFocusAfterRender();
  const [state, setState] = useState<State>('loading');
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [columns, setColumns] = useState<ImportColumn[]>([]);
  const [view, setView] = useState<View>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const requestId = useRef(0);
  const holder = isAccountHolder(vendor.me);

  const load = useCallback(async () => {
    if (!token || !id) { if (!id) setState('notFound'); return; }
    const req = ++requestId.current;
    setState(s => (s === 'ready' ? s : 'loading'));
    try {
      const res = await importApi.get(token, id);
      if (req !== requestId.current) return;
      setBatch(res.batch); setColumns(res.columns); setState('ready');
    } catch (err) {
      if (req !== requestId.current || vendor.handleError(err)) return;
      if (apiCode(err) === 'import_not_found') setState('notFound');
      else { setLoadError(errorText(err, locale, t)); setState('error'); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id, locale]);
  useEffect(() => { void load(); }, [load]);

  // While an apply loop runs, the step it started on stays on screen (the batch's status moves between calls).
  const [pinned, setPinned] = useState<ImportStep | null>(null);
  const derived: ImportStep | null = batch ? stepOfBatch(batch, view) : null;
  const derivedRef = useRef(derived);
  derivedRef.current = derived;
  const onPin = useCallback((on: boolean) => setPinned(on ? derivedRef.current : null), []);
  const step = pinned ?? derived;
  // A batch found applying (another tab, an interrupted run) opens on the confirm step so it can be continued.
  useEffect(() => { if (batch?.status === 'applying' && view !== 'confirm') setView('confirm'); }, [batch?.status, view]);
  // Move focus to the new step's heading (not on the first render: that would steal focus on page load).
  const lastStep = useRef<ImportStep | null>(null);
  useEffect(() => {
    if (step && lastStep.current && lastStep.current !== step) focusAfterRender(() => document.querySelector<HTMLElement>('[data-step-heading]'));
    lastStep.current = step;
  }, [step, focusAfterRender]);

  const onBatch = useCallback((b: ImportBatch) => { setBatch(b); }, []);
  const back = <BackLink href="/vendor/import/" label={t('vendor.import.backToList')} />;

  if (state === 'loading') return <div className="space-y-4" aria-busy="true">{back}<SkeletonCard /><SkeletonCard /></div>;
  if (state === 'error') return <div className="space-y-4">{back}<ErrorState title={t('vendor.import.loadError')} message={loadError} onRetry={load} retryLabel={t('vendor.import.retry')} /></div>;
  if (state === 'notFound' || !batch || !step) {
    return <div className="space-y-4">{back}<ErrorState title={t('vendor.import.notFound.title')} message={t('vendor.import.notFound.body')} /></div>;
  }

  // The business profile is the account holder's: staff see it but cannot change or apply it.
  const readOnly = batch.entity === 'profile' && !holder;

  return (
    <div className="mx-auto max-w-3xl space-y-4" data-testid="import-batch" data-status={batch.status}>
      {back}
      <PageHeader title={batch.filename} description={<StatusBadge status={batch.status} />} />
      {batch.status !== 'discarded' && <Stepper current={step} />}
      {readOnly && <Alert tone="info" className="[overflow-wrap:anywhere]" >{t('vendor.import.ownerOnly')}</Alert>}

      {batch.status === 'discarded' && (
        <div className="space-y-3" data-testid="import-discarded">
          <StepHeading hint={t('vendor.import.discarded.body')}>{t('vendor.import.discarded.title')}</StepHeading>
          <Link href="/vendor/import/new/" className={primaryLinkCls}>{t('vendor.import.result.newImport')}</Link>
        </div>
      )}
      {step === 'columns' && !readOnly && (
        <ColumnsStep
          key={batch.updatedAt}
          batch={batch}
          columns={columns}
          onSaved={b => { setBatch(b); setView('check'); void load(); }}
          onCancel={batch.status === 'ready' ? () => setView('check') : undefined}
          onStale={() => { setView(null); void load(); }}
        />
      )}
      {step === 'check' && <CheckStep batch={batch} readOnly={readOnly} onColumns={() => setView('columns')} onNext={() => setView('confirm')} onDiscard={() => setDiscarding(true)} />}
      {step === 'confirm' && <ConfirmStep batch={batch} readOnly={readOnly} onBatch={onBatch} onPin={onPin} onBack={() => setView('check')} onDiscard={() => setDiscarding(true)} />}
      {step === 'result' && <ResultStep batch={batch} readOnly={readOnly} onBatch={onBatch} onPin={onPin} />}

      <DiscardDialog
        batch={batch}
        open={discarding}
        onClose={() => setDiscarding(false)}
        onDiscarded={b => { setDiscarding(false); setBatch(b); setView(null); }}
        onStale={() => { void load(); }}
      />
    </div>
  );
}

export default function VendorImportBatchPage() {
  return <Suspense fallback={<SkeletonCard />}><BatchInner /></Suspense>;
}
