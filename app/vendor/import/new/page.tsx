'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { eatDateTime, fmt } from '@/lib/vendor';
import { useFocusAfterRender } from '@/lib/use-focus-after-render';
import {
  IMPORT_ENTITIES, apiBody, apiCode, entityKey, errorText, importApi, isAccountHolder, limitsOf, megabytes, statusKey, type ImportEntity,
} from '@/lib/vendor-import';
import { Alert, Field, PageHeader, Radio } from '@/components/shared';
import { BackLink, Stepper, linkBtnCls, Btn } from '@/components/vendor/import/parts';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../../providers';

type Problem =
  | { kind: 'text'; text: string }
  | { kind: 'duplicate'; batchId: string; createdAt: string; status: string }
  | { kind: 'quota'; text: string };

const isExcel = (name: string) => /\.(xlsx|xlsm|xlsb|xls)$/i.test(name);

/** Steps 1 and 2 of the wizard: choose what to import, then upload the CSV. The batch page takes over from step 3. */
export default function NewImportPage() {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const router = useRouter();
  const focusAfterRender = useFocusAfterRender();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState<'choose' | 'upload'>('choose');
  const [entity, setEntity] = useState<ImportEntity>('products');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const limits = limitsOf(vendor.me?.tools);
  const holder = isAccountHolder(vendor.me);
  const blocked = !!file && (isExcel(file.name) || file.size > limits.maxBytes);
  const canChoose = (e: ImportEntity) => e !== 'profile' || holder;

  const go = (next: 'choose' | 'upload') => { setStep(next); setProblem(null); focusAfterRender(() => headingRef.current); };

  const onFile = (f: File | null) => {
    setFile(f); setProblem(null);
    if (!f) return;
    // Cheap checks before sending anything; the server checks again (xlsx bytes under a .csv name are caught there).
    if (isExcel(f.name)) setProblem({ kind: 'text', text: t('vendor.import.upload.xlsx') });
    else if (f.size > limits.maxBytes) setProblem({ kind: 'text', text: fmt(t('vendor.import.upload.tooLarge'), { mb: megabytes(limits.maxBytes) }) });
  };

  const upload = async () => {
    if (!token || busy) return;
    if (!file) { setProblem({ kind: 'text', text: t('vendor.import.upload.noFile') }); return; }
    if (blocked) return;
    setBusy(true); setProblem(null);
    try {
      const { batch } = await importApi.upload(token, entity, file);
      router.push(`/vendor/import/batch/?id=${encodeURIComponent(batch.id)}`);
    } catch (err) {
      setBusy(false);
      if (vendor.handleError(err)) return;
      const code = apiCode(err);
      const body = apiBody<{ batchId?: string; createdAt?: string; status?: string; hint?: string }>(err);
      if (code === 'duplicate_file' && body?.batchId) setProblem({ kind: 'duplicate', batchId: body.batchId, createdAt: body.createdAt ?? '', status: body.status ?? '' });
      else if (code === 'import_quota') setProblem({ kind: 'quota', text: errorText(err, locale, t) });
      else if (code === 'unsupported_file_type' && body?.hint === 'xlsx_not_supported_yet') setProblem({ kind: 'text', text: t('vendor.import.upload.xlsx') });
      else setProblem({ kind: 'text', text: errorText(err, locale, t) });
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4" data-testid="import-new">
      <BackLink href="/vendor/import/" label={t('vendor.import.backToList')} />
      <PageHeader title={t('vendor.import.title')} />
      <Stepper current={step} />

      {step === 'choose' && (
        <section aria-labelledby="import-choose-title" className="space-y-4">
          <div>
            <h2 id="import-choose-title" ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-[var(--color-fg-primary)] outline-none">{t('vendor.import.choose.title')}</h2>
            <p className="mt-1 text-sm text-[var(--color-fg-quaternary)]">{t('vendor.import.choose.body')}</p>
          </div>
          <fieldset className="space-y-2">
            <legend className="sr-only">{t('vendor.import.choose.title')}</legend>
            {IMPORT_ENTITIES.map(e => (
              <div key={e} className={`rounded-[var(--radius-xl)] border px-3 ${entity === e ? 'border-[var(--color-brand-600)] bg-[var(--color-brand-50)]' : 'border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)]'}`}>
                <Radio
                  name="import-entity"
                  value={e}
                  checked={entity === e}
                  disabled={!canChoose(e)}
                  onChange={() => setEntity(e)}
                  label={t(entityKey(e))}
                  description={canChoose(e) ? t(`vendor.import.entity.${e}.desc` as 'vendor.import.entity.products.desc') : t('vendor.import.entity.profileOwnerOnly')}
                  labelClassName="flex w-full"
                  data-testid={`entity-${e}`}
                />
              </div>
            ))}
          </fieldset>
          <Btn onClick={() => go('upload')} className="max-sm:w-full" data-testid="import-choose-next">{t('vendor.import.continue')}</Btn>
        </section>
      )}

      {step === 'upload' && (
        <section aria-labelledby="import-upload-title" className="space-y-4" aria-busy={busy}>
          <div>
            <h2 id="import-upload-title" ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-[var(--color-fg-primary)] outline-none">{t('vendor.import.upload.title')}</h2>
            <p className="mt-1 text-sm text-[var(--color-fg-quaternary)]">{fmt(t('vendor.import.upload.entityLabel'), { entity: t(entityKey(entity)) })}</p>
          </div>
          <Field label={t('vendor.import.upload.label')} hint={fmt(t('vendor.import.upload.hint'), { mb: megabytes(limits.maxBytes), rows: limits.maxRows.toLocaleString('en-US') })}>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={e => onFile(e.target.files?.[0] ?? null)}
              data-testid="import-file"
              className="block min-h-11 w-full rounded-[var(--radius-lg)] border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] p-2 text-sm text-[var(--color-fg-secondary)] file:mr-3 file:min-h-9 file:rounded-[var(--radius-md)] file:border-0 file:bg-[var(--color-bg-tertiary)] file:px-3 file:text-sm file:font-semibold"
            />
          </Field>
          {file && !blocked && !problem && <p className="text-sm text-[var(--color-fg-secondary)] [overflow-wrap:anywhere]" data-testid="import-file-chosen">{fmt(t('vendor.import.upload.chosen'), { name: file.name, size: megabytes(file.size) })}</p>}

          {problem?.kind === 'text' && <Alert tone="error">{problem.text}</Alert>}
          {problem?.kind === 'quota' && <Alert tone="warning"><strong className="block">{t('vendor.import.quota.title')}</strong>{problem.text}</Alert>}
          {problem?.kind === 'duplicate' && (
            <Alert tone="warning">
              <strong className="block">{t('vendor.import.dup.title')}</strong>
              <span className="block">{fmt(t('vendor.import.dup.body'), { date: eatDateTime(problem.createdAt, locale), status: t(statusKey(problem.status)) })}</span>
              <Link href={`/vendor/import/batch/?id=${encodeURIComponent(problem.batchId)}`} className={`${linkBtnCls} mt-3`} data-testid="import-dup-open">{t('vendor.import.dup.open')}</Link>
            </Alert>
          )}
          {busy && <p role="status" className="text-sm text-[var(--color-fg-secondary)]">{t('vendor.import.upload.uploading')}</p>}

          <div className="flex flex-col gap-3 sm:flex-row">
            <Btn variant="secondary" onClick={() => go('choose')} disabled={busy} className="max-sm:w-full">{t('vendor.import.back')}</Btn>
            <Btn onClick={upload} loading={busy} disabled={!file || blocked} className="max-sm:w-full" data-testid="import-upload">{t('vendor.import.upload.button')}</Btn>
          </div>
        </section>
      )}
    </div>
  );
}
