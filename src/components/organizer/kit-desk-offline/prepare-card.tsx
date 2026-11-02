'use client';
// Events S7 offline kit desk (spec §3.14 "Not prepared", §3.3, §3.15): name the desk, choose where it works, optionally give it a bib block (owner and admin
// only), and download the ticket list. The block is immutable once created, so the form says so before the download.
import { useMemo, useState } from 'react';
import { Download, HardDrive } from 'lucide-react';
import { fmt } from '@/lib/events';
import { s7CodeKey } from '@/lib/events-s7';
import type { EventDocument } from '@/lib/api';
import { Alert, Button, Card, CardContent, Field, Input, Select } from '@/components/shared';
import { BIB_PREFIX_RE, previewBlock } from './desk-logic';
import type { KitDeskApi, PrepareFailure } from './use-kit-desk';
import { useApp } from '../../../../app/providers';

export function PrepareCard({ doc, desk, canSetBlock, staffName, userId, role, readOnly }: {
  doc: EventDocument | null; desk: KitDeskApi; canSetBlock: boolean; staffName: string | null; userId: string | null; role: string | null; readOnly: boolean;
}) {
  const { t } = useApp();
  const points = (doc?.collectionPoints ?? []).filter(p => !!p.id) as Array<{ id: string; name: string }>;
  const [label, setLabel] = useState('');
  const [pointId, setPointId] = useState(points.length === 1 ? points[0].id : '');
  const [categoryId, setCategoryId] = useState('');
  const [tooLarge, setTooLarge] = useState(false);
  const [useBlock, setUseBlock] = useState(false);
  const [prefix, setPrefix] = useState('');
  const [pad, setPad] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [failure, setFailure] = useState<PrepareFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => previewBlock(prefix, pad, from, to), [prefix, pad, from, to]);
  const prefixOk = BIB_PREFIX_RE.test(prefix);
  const blockOk = !useBlock || (!!preview && prefixOk);
  const blockTouched = useBlock && (from || to);
  const nameOk = label.trim().length >= 1 && label.trim().length <= 40;
  const hours = desk.meta?.limits.sessionHours ?? 36;
  const pointOk = points.length === 0 || !!pointId;

  async function go() {
    setBusy(true); setFailure(null);
    const f = await desk.prepare({
      label, pointId, categoryId: categoryId || null, eventTitle: doc?.title ?? '', role, staffName, userId, points,
      bib: useBlock && preview ? { prefix, padTo: pad ? Number(pad) : 0, start: Number(from), end: Number(to) } : null,
    });
    if (f?.code === 'snapshot_too_large') setTooLarge(true);
    setFailure(f); setBusy(false);
  }

  const failureText = !failure ? null
    : failure.code === 'device_limit_reached' ? fmt(t('organizer.kitOffline.prepare.limit'), { max: Number((failure.extra as { max?: number } | undefined)?.max ?? 10) })
    : failure.code === 'bib_range_overlap' ? fmt(t('organizer.kitOffline.prepare.bibOverlap'), { desk: String((failure.extra as { with?: string } | undefined)?.with ?? '') })
    : failure.code === 'network' ? t('common.errorBody') : t(s7CodeKey(failure.code));

  return (
    <Card data-testid="offline-prepare">
      <CardContent className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-fg-primary)]">{t('organizer.kitOffline.prepare.title')}</h2>
          <p className="mt-1 text-sm text-[var(--color-fg-secondary)]">{fmt(t('organizer.kitOffline.prepare.body'), { hours })}</p>
          <p className="mt-1 text-sm text-[var(--color-fg-quaternary)]" data-testid="offline-prepare-hint">{t('organizer.kitOffline.prepare.hint')}</p>
        </div>
        {failureText && <div role="alert" data-testid="offline-prepare-error"><Alert tone="error">{failureText}</Alert></div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('organizer.kitOffline.prepare.name')} hint={t('organizer.kitOffline.prepare.nameHint')} required>
            <Input value={label} maxLength={40} onChange={e => setLabel(e.target.value)} data-testid="offline-label" />
          </Field>
          {points.length > 0 && (
            <Field label={t('organizer.kitOffline.prepare.point')} required>
              <Select value={pointId} onChange={e => setPointId(e.target.value)} data-testid="offline-prepare-point">
                <option value="">—</option>
                {points.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          )}
          {tooLarge && (
            <Field label={t('organizer.kitOffline.prepare.category')} hint={t('organizer.kitOffline.prepare.tooLarge')} required>
              <Select value={categoryId} onChange={e => setCategoryId(e.target.value)} data-testid="offline-category">
                <option value="">—</option>
                {(doc?.categories ?? []).filter(c => !!c.id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          )}
        </div>

        {/* §3.15 the bib block */}
        <fieldset className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] p-3" data-testid="offline-bib-block">
          <legend className="px-1 text-sm font-medium text-[var(--color-fg-secondary)]">{t('organizer.kitOffline.prepare.bibBlock')}</legend>
          {!canSetBlock
            ? <p className="text-sm text-[var(--color-fg-quaternary)]" data-testid="offline-bib-none">{t('organizer.kitOffline.prepare.bibNone')}</p>
            : (
              <>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={useBlock} onChange={e => setUseBlock(e.target.checked)} data-testid="offline-bib-use" />
                  {t('organizer.kitOffline.prepare.bibBlock')}
                </label>
                {useBlock && (
                  <>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Field label={t('organizer.kitOffline.prepare.bibPrefix')} error={prefixOk ? undefined : t('organizer.kitOffline.bib.invalid')}>
                        <Input value={prefix} maxLength={4} onChange={e => setPrefix(e.target.value.toUpperCase())} className="font-mono" data-testid="offline-bib-prefix" />
                      </Field>
                      <Field label={t('organizer.kitOffline.prepare.bibPad')}>
                        <Input value={pad} inputMode="numeric" maxLength={1} onChange={e => setPad(e.target.value.replace(/\D/g, '').replace(/[7-9]/, ''))} className="font-mono" data-testid="offline-bib-pad" />
                      </Field>
                      <Field label={t('organizer.kitOffline.prepare.bibFrom')} required>
                        <Input value={from} inputMode="numeric" onChange={e => setFrom(e.target.value.replace(/\D/g, ''))} className="font-mono" data-testid="offline-bib-from" />
                      </Field>
                      <Field label={t('organizer.kitOffline.prepare.bibTo')} required>
                        <Input value={to} inputMode="numeric" onChange={e => setTo(e.target.value.replace(/\D/g, ''))} className="font-mono" data-testid="offline-bib-to" />
                      </Field>
                    </div>
                    <p className="text-sm text-[var(--color-fg-secondary)]" role="status" data-testid="offline-bib-preview">
                      {preview ? fmt(t('organizer.kitOffline.prepare.bibPreview'), { first: preview.first, last: preview.last, count: preview.count }) : blockTouched ? t('events.s7.bib.rangeInvalid') : ''}
                    </p>
                    <p className="text-xs text-[var(--color-fg-quaternary)]">{t('events.s7.bib.immutable')}</p>
                  </>
                )}
              </>
            )}
        </fieldset>

        {desk.persisted === false && <p className="flex items-start gap-2 text-sm text-[var(--color-warning-800)]" data-testid="offline-persist-warning"><HardDrive aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{t('organizer.kitOffline.prepare.storage')}</p>}
        {desk.progress && <p role="status" className="text-sm text-[var(--color-fg-secondary)]" data-testid="offline-progress">{fmt(t('organizer.kitOffline.prepare.progress'), { done: desk.progress.done, total: desk.progress.total || desk.progress.done })}</p>}
        <div className="flex justify-end">
          <Button size="lg" className="min-h-14" loading={busy} disabled={readOnly || !nameOk || !pointOk || !blockOk || (tooLarge && !categoryId) || !desk.online} onClick={() => void go()} data-testid="offline-download">
            <Download aria-hidden="true" className="h-4 w-4" />{t('organizer.kitOffline.prepare.button')}
          </Button>
        </div>
        {!desk.online && <p className="text-sm text-[var(--color-warning-800)]">{t('organizer.kitOffline.banner.s5')}</p>}
      </CardContent>
    </Card>
  );
}
