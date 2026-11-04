'use client';
// Smart Import (wizard) shared pieces: step bar, status badge, progress bar, template download, back link, issue list.
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileDown } from 'lucide-react';
import { fmt } from '@/lib/vendor';
import {
  IMPORT_ENTITIES, IMPORT_STEPS, entityKey, errorText, hasMessageKey, importApi, isAccountHolder, issueText, severityTone, statusKey, statusTone,
  stepKey, type ImportEntity, type ImportIssue, type ImportStep,
} from '@/lib/vendor-import';
import { Alert, Badge, Button, Checkbox, Field, Segmented, Select } from '@/components/shared';
import { cn } from '@/lib/cn';
import { saveBlob } from '@/components/vendor/documents/share-menu';
import { useVendor } from '@/components/vendor-context';
import { useApp } from '../../../../app/providers';

/** "Step 3 of 6: Columns" and a segment bar; the numbered list is for screen readers and the wide view. */
export function Stepper({ current }: { current: ImportStep }) {
  const { t } = useApp();
  const index = IMPORT_STEPS.indexOf(current);
  return (
    <nav aria-label={t('vendor.import.stepsLabel')} className="mb-5" data-testid="import-steps">
      <p className="text-sm font-semibold text-[var(--color-fg-primary)] [overflow-wrap:anywhere] sm:hidden" data-testid="import-step-text">
        {fmt(t('vendor.import.stepOf'), { n: index + 1, total: IMPORT_STEPS.length, name: t(stepKey(current)) })}
      </p>
      <ol className="mt-2 flex gap-1.5 sm:mt-0 sm:gap-3">
        {IMPORT_STEPS.map((s, i) => (
          <li key={s} aria-current={i === index ? 'step' : undefined} className="min-w-0 flex-1">
            <span className={`block h-1.5 rounded-full ${i < index ? 'bg-[var(--color-brand-600)]' : i === index ? 'bg-[var(--color-brand-400)]' : 'bg-[var(--color-bg-tertiary)]'}`} aria-hidden="true" />
            <span className={`mt-1.5 hidden text-xs [overflow-wrap:anywhere] sm:block ${i === index ? 'font-semibold text-[var(--color-fg-primary)]' : 'text-[var(--color-fg-quaternary)]'}`}>
              {i + 1}. {t(stepKey(s))}
            </span>
            <span className="sr-only sm:hidden">{i + 1}. {t(stepKey(s))}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The design-system Button at the 44px touch-target minimum. */
export function Btn({ className, ...rest }: React.ComponentProps<typeof Button>) {
  // h-auto + padding: a long Swahili label wraps inside the button instead of being clipped by the fixed height.
  return <Button {...rest} className={cn('h-auto min-h-11 py-2 text-center', className)} />;
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useApp();
  return <Badge tone={statusTone(status)}>{t(statusKey(status))}</Badge>;
}

export function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
      <div className="h-full rounded-full bg-[var(--color-brand-600)] transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}

export const linkBtnCls = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)] px-4 text-sm font-semibold text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-secondary)]';
export const primaryLinkCls = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[var(--color-brand-600)] px-4 text-sm font-semibold text-white hover:bg-[var(--color-brand-700)]';

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--color-brand-700)] hover:underline">
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />{label}
    </Link>
  );
}

/** Template download: entity, column-name language and optional example rows; fetched with the sign-in header. */
export function TemplatePanel() {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const [entity, setEntity] = useState<ImportEntity>('products');
  const [lang, setLang] = useState<'en' | 'sw'>(locale);
  const [example, setExample] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const download = async () => {
    if (!token) return;
    setBusy(true); setFailed(null);
    try {
      const { blob, fileName } = await importApi.template(token, entity, lang, example);
      saveBlob(blob, fileName);
    } catch (err) {
      if (!vendor.handleError(err)) setFailed(errorText(err, locale, t) || t('vendor.import.template.failed'));
    } finally { setBusy(false); }
  };
  return (
    <section aria-labelledby="import-template-title" className="rounded-[var(--radius-xl)] border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] p-4 sm:p-5" data-testid="import-template">
      <h2 id="import-template-title" className="text-base font-semibold text-[var(--color-fg-primary)]">{t('vendor.import.template.title')}</h2>
      <p className="mt-1 text-sm text-[var(--color-fg-quaternary)]">{t('vendor.import.template.body')}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label={t('vendor.import.template.entity')}>
          <Select value={entity} onChange={e => setEntity(e.target.value as ImportEntity)} data-testid="template-entity">
            {IMPORT_ENTITIES.map(e => <option key={e} value={e}>{t(entityKey(e))}</option>)}
          </Select>
        </Field>
        <div className="flex flex-col gap-1.5">
          <span id="import-template-lang" className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('vendor.import.template.lang')}</span>
          <Segmented value={lang} onChange={v => setLang(v as 'en' | 'sw')} options={[['en', t('vendor.import.lang.en')], ['sw', t('vendor.import.lang.sw')]]} />
        </div>
      </div>
      <Checkbox label={t('vendor.import.template.example')} checked={example} onChange={e => setExample(e.target.checked)} data-testid="template-example" />
      {failed && <Alert tone="error" className="mt-2">{failed}</Alert>}
      <div className="mt-3">
        <Btn variant="secondary" onClick={download} loading={busy} data-testid="template-download" className="max-sm:w-full">
          <FileDown aria-hidden="true" className="h-4 w-4" />{t('vendor.import.template.download')}
        </Btn>
      </div>
    </section>
  );
}

/** One row's issues in the active language: the server's text, else the portal's own wording for the code. */
export function IssueList({ issues }: { issues: ImportIssue[] }) {
  const { t, locale } = useApp();
  if (!issues.length) return null;
  return (
    <ul className="mt-2 space-y-1.5">
      {issues.map((issue, i) => (
        <li key={`${issue.code}-${i}`} className="flex items-start gap-2 text-sm text-[var(--color-fg-secondary)]" data-issue={issue.code}>
          <span className="mt-0.5 shrink-0">
            {issue.severity === 'info'
              ? <span aria-hidden="true" className="px-2 text-[var(--color-fg-quaternary)]">•</span>
              : <Badge tone={severityTone(issue.severity)}>{issue.severity === 'error' ? t('vendor.import.rowStatus.invalid') : t('vendor.import.rowStatus.needs_review')}</Badge>}
          </span>
          <span className="min-w-0 [overflow-wrap:anywhere]">{issueText(issue, locale, t, hasMessageKey)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The account holder may import a profile; staff may not (the server answers 403 profile_import_owner_only). */
export function useIsAccountHolder() {
  const vendor = useVendor();
  return isAccountHolder(vendor.me);
}

/** The heading a step moves focus to when the step changes (the batch page looks for [data-step-heading]). */
export function StepHeading({ children, hint, id }: { children: React.ReactNode; hint?: React.ReactNode; id?: string }) {
  return (
    <div>
      <h2 id={id} data-step-heading tabIndex={-1} className="text-lg font-semibold text-[var(--color-fg-primary)] outline-none [overflow-wrap:anywhere]">{children}</h2>
      {hint && <p className="mt-1 text-sm text-[var(--color-fg-quaternary)]">{hint}</p>}
    </div>
  );
}

/** "Download problem report": errors.csv fetched with the sign-in header and saved as a blob. */
export function ErrorsDownload({ batchId, variant = 'secondary' }: { batchId: string; variant?: 'secondary' | 'ghost' }) {
  const { token, t, locale } = useApp();
  const vendor = useVendor();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const run = async () => {
    if (!token) return;
    setBusy(true); setFailed(null);
    try {
      const { blob, fileName } = await importApi.errorsCsv(token, batchId);
      saveBlob(blob, fileName);
    } catch (err) {
      if (!vendor.handleError(err)) setFailed(errorText(err, locale, t) || t('vendor.import.result.errorsFailed'));
    } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-2">
      <Btn variant={variant} onClick={run} loading={busy} data-testid="import-errors-download" className="max-sm:w-full">
        <FileDown aria-hidden="true" className="h-4 w-4" />{t('vendor.import.result.errors')}
      </Btn>
      {failed && <Alert tone="error">{failed}</Alert>}
    </div>
  );
}
