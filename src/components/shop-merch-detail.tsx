'use client';
import { useCallback, useEffect, useId, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { MessageKey } from '@/lib/i18n';
import { eatDateTime, fmt } from '@/lib/vendor';
import {
  AUDIENCE_KEY, PHASE_KEY, PHASE_TONE, REJECT_CODES, REJECT_KEY, REVIEW_CHECKS, TARGET_KEY, reasonText, bannersApi, errorCodeOf, errorKeyOf, headlineOf, phaseOf, targetLabelOf,
  type AuditRow, type BannerAction, type RejectCode, type ShopBanner,
} from '@/lib/shop-banners';
import { Alert, Badge, Button, Card, CardContent, CardHeader, Checkbox, Field, Input, Radio, Spinner, Textarea } from './shared';
import { Dialog } from './dialog';
import { BannerPreview, useBannerPhoto } from './shop-banner-preview';
import { useToast } from './ui/toast';
import { api } from '@/lib/api';
import { useApp } from '../../app/providers';

const CHECK_KEY: Record<(typeof REVIEW_CHECKS)[number], MessageKey> = {
  people: 'merchAdmin.check.people', text: 'merchAdmin.check.text', languages: 'merchAdmin.check.languages',
};
const HIST_KEY: Record<string, MessageKey> = {
  created: 'merchAdmin.hist.created', updated: 'merchAdmin.hist.updated', image_uploaded: 'merchAdmin.hist.image', submitted: 'merchAdmin.hist.submitted',
  approved: 'merchAdmin.hist.approved', rejected: 'merchAdmin.hist.rejected', withdrawn: 'merchAdmin.hist.withdrawn', ended: 'merchAdmin.hist.ended',
  expired: 'merchAdmin.hist.expired', position_set: 'merchAdmin.hist.position', image_published: 'merchAdmin.hist.imagePublished',
  image_orphaned: 'merchAdmin.hist.imageOrphaned', public_files_orphaned: 'merchAdmin.hist.publicFilesOrphaned',
};
/** Refusals worded for the admin (the seller's state, not "your account"). */
const ADMIN_ERROR_KEY: Record<string, MessageKey> = {
  vendor_suspended: 'merchAdmin.sellerSuspended', vendor_not_approved: 'merchAdmin.sellerNotApproved', target_not_eligible: 'merchAdmin.targetNotEligible',
};
const adminErrorKey = (err: unknown): MessageKey => ADMIN_ERROR_KEY[errorCodeOf(err) ?? ''] ?? errorKeyOf(err, 'merchAdmin.actionFailed');
const NOTE_MIN = 10;
const NOTE_MAX = 500;

/**
 * H1: whoever created, sent, changed or uploaded the photo of a banner can't approve or reject it
 * (the server answers 403 cannot_approve_own_submission). Uses the server's ownItem plus what the view shows.
 */
export function workedOn(b: ShopBanner, userId: string | undefined): 'created' | 'worked' | null {
  if (userId && (userId === b.createdBy || userId === b.submittedBy)) return 'created';
  const img = b.image;
  if (userId && ((b.editedBy ?? []).includes(userId) || [img?.uploadedBy, img?.rightsConfirmedBy, img?.peopleConfirmedBy].includes(userId))) return 'worked';
  // The server's ownItem covers all of the above, whatever this view shows.
  return b.ownItem ? 'worked' : null;
}

/**
 * One banner in the merch queue (spec §5.3.2): previews in both languages and themes, every text in both
 * languages, the uploader's confirmations, its history, and only what this admin may do (the server's
 * allowedActions). Approving or rejecting your own banner is blocked here and by the server (403
 * cannot_approve_own_submission); ending is always allowed with `promotions_approve`.
 */
export function ShopMerchDetail({ id, fallback, onBack, onEdit, onChanged }: {
  id: string; fallback?: ShopBanner | null; onBack: () => void; onEdit: (id: string) => void; onChanged: () => void;
}) {
  const { token, t, locale, user, hasPermission } = useApp();
  const toast = useToast();
  const ownHintId = useId();
  const [banner, setBanner] = useState<ShopBanner | null>(fallback ?? null);
  const [history, setHistory] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [dialog, setDialog] = useState<'approve' | 'reject' | 'end' | 'position' | 'withdraw' | null>(null);
  const [busy, setBusy] = useState(false);
  const [staleNotice, setStaleNotice] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try { const r = await bannersApi.adminGet(token, id); setBanner(r.banner); setHistory(r.history); }
    catch (err) {
      if (errorCodeOf(err) === 'banner_not_found') setNotFound(true);
      else setError(t(errorKeyOf(err, 'merchAdmin.loadFailed')));
    }
  }, [token, id, t]);
  useEffect(() => { void load(); }, [load]);

  // "Links to: {store}" with the store's name, not its id (QA1 #7).
  const [storeNames, setStoreNames] = useState<Record<string, string>>({});
  const storeId = banner?.target?.type === 'vendor_store' && typeof banner.target.value === 'string' ? banner.target.value : null;
  useEffect(() => {
    if (!token || !storeId || storeNames[storeId]) return;
    api.adminVendors(token)
      .then(list => setStoreNames(Object.fromEntries(list.map(v => [v.id, v.displayName || v.id]))))
      .catch(() => {});
  }, [token, storeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const photo = useBannerPhoto(banner, 960);
  const widePhoto = useBannerPhoto(banner, 960, true);

  if (notFound) return <div className="space-y-4"><Alert tone="warning">{t('merch.notYours')}</Alert><Button variant="secondary" onClick={onBack}>{t('merchAdmin.back')}</Button></div>;
  if (!banner) return error ? <Alert tone="error">{error}</Alert> : <Spinner className="h-6 w-6" />;

  const phase = phaseOf(banner);
  const canApproveScope = hasPermission('promotions_approve');
  const own = workedOn(banner, user?.id);
  const mine = !!own;
  const pending = phase === 'pending';
  const allowed = (a: BannerAction) => (Array.isArray(banner.allowedActions) ? banner.allowedActions.includes(a) : false);
  // Shown disabled with the reason, so the admin sees why (spec §5.3.2 "Own item").
  const showDecide = pending && canApproveScope;
  const decideBlocked = showDecide && mine;

  const finish = async (doneKey: MessageKey, next?: ShopBanner | null) => {
    setDialog(null); setStaleNotice(false);
    toast.success(t(doneKey));
    if (next?.id) setBanner(next);
    await load();
    onChanged();
  };
  const stale = () => { setDialog(null); setStaleNotice(true); void load(); onChanged(); };
  const simple = async (fn: () => Promise<ShopBanner>, doneKey: MessageKey) => {
    if (busy) return;
    setBusy(true);
    try { await finish(doneKey, await fn()); }
    catch (err) { toast.error(t(adminErrorKey(err))); }
    finally { setBusy(false); }
  };

  const both = (b: { en: string; sw: string } | null | undefined) => b ? (
    <div className="space-y-0.5">
      <p><span className="text-xs font-semibold text-[var(--color-fg-quaternary)]">{t('merch.field.en')} · </span><span lang="en">{b.en || '—'}</span></p>
      <p><span className="text-xs font-semibold text-[var(--color-fg-quaternary)]">{t('merch.field.sw')} · </span><span lang="sw">{b.sw || '—'}</span></p>
    </div>
  ) : '—';
  const row = (label: string, value: React.ReactNode, testId?: string) => (
    <div className="grid gap-1 py-2 sm:grid-cols-3 [&>*]:min-w-0 [overflow-wrap:anywhere]"><dt className="text-sm text-[var(--color-fg-tertiary)]">{label}</dt><dd className="text-sm sm:col-span-2" data-testid={testId}>{value}</dd></div>
  );
  const img = banner.image;
  const targetName = storeId
    ? banner.targetName || (storeId === banner.vendorId ? banner.vendorName : null) || storeNames[storeId] || storeId
    : targetLabelOf(banner);
  const confirmedBy = (who: string | null | undefined, name: string | null | undefined, at: string | null | undefined) =>
    who || name || at ? fmt(t('merchAdmin.confirmedBy'), { name: name || who || '—', date: eatDateTime(at, locale) }) : t('merchAdmin.notRecorded');
  const person = (idv?: string | null, name?: string | null) => name || idv || '';

  return (
    <div className="space-y-6" data-testid="merch-detail">
      <Button variant="link" onClick={onBack} className="-ml-2 h-auto min-h-10 gap-1.5 px-2 text-sm font-normal text-[var(--color-fg-tertiary)] hover:text-[var(--color-fg-primary)] hover:no-underline" data-testid="merch-back">
        <ArrowLeft className="h-4 w-4" />{t('merchAdmin.back')}
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
      {staleNotice && <Alert tone="warning"><span data-testid="merch-stale">{t('merchAdmin.bannerChanged')}</span></Alert>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-full [overflow-wrap:anywhere]">
          <p className="text-xs uppercase tracking-wide text-[var(--color-fg-quaternary)]">{t('merchAdmin.type.banner')} · {banner.origin === 'staff' ? t('merchAdmin.sellerFitflex') : banner.vendorName || banner.vendorId}</p>
          <h1 className="text-xl font-semibold" data-testid="merch-headline">{headlineOf(banner, locale) || '—'}</h1>
          {reasonText(banner, t) && <p className="mt-1 text-sm text-[var(--color-fg-tertiary)]" data-testid="merch-reason">{fmt(t('merch.line.reason'), { reason: reasonText(banner, t) })}</p>}
        </div>
        <Badge tone={PHASE_TONE[phase]} dot><span data-testid="merch-status">{t(PHASE_KEY[phase])}</span></Badge>
      </div>
      {banner.sellerSuspended && <Alert tone="warning">{t('merchAdmin.sellerSuspended')}</Alert>}

      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardContent className="p-5">
              <BannerPreview layouts={['phone', 'desktop']} look={{
                imageUrl: photo, wideImageUrl: widePhoto,
                headlineLead: banner.headlineLead, headlineAccent: banner.headlineAccent, subline: banner.subline, ctaLabel: banner.ctaLabel,
                vendorName: banner.origin === 'vendor' ? banner.vendorName || banner.vendorId : null,
              }} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><h2 className="font-semibold">{t('merchAdmin.details')}</h2></CardHeader>
            <CardContent>
              <dl className="divide-y divide-[var(--color-border-secondary)]" data-testid="merch-terms">
                {row(t('merch.banner.lead'), both(banner.headlineLead))}
                {row(t('merch.banner.accent'), both(banner.headlineAccent))}
                {row(t('merch.banner.subline'), both(banner.subline))}
                {row(t('merch.banner.alt'), both(banner.imageAlt))}
                {row(t('merchAdmin.ctaLabel'), both(banner.ctaLabel))}
                {row(t('merch.banner.target'), banner.target ? `${t(TARGET_KEY[banner.target.type])}${targetName ? `: ${targetName}` : ''}` : '—', 'merch-target')}
                {row(t('merch.banner.showTo'), (banner.audienceRoles ?? []).map(r => (AUDIENCE_KEY[r] ? t(AUDIENCE_KEY[r]) : r)).join(', ') || '—', 'merch-audience')}
                {row(t('merchAdmin.col.dates'), `${eatDateTime(banner.startsAt, locale)} → ${eatDateTime(banner.endsAt, locale)} (${t('merch.dates.tzNote')})`)}
                {row(t('merchAdmin.col.position'), <span data-testid="merch-position">{banner.position ?? '—'}</span>)}
                {row(t('merch.banner.people'), img?.people === 'product_models' ? t('merch.banner.peopleModels') : img?.people === 'none' ? t('merch.banner.peopleNone') : '—', 'merch-people')}
                {row(t('merchAdmin.rightsConfirmed'), confirmedBy(img?.rightsConfirmedBy, img?.rightsConfirmedByName, img?.rightsConfirmedAt), 'merch-rights')}
                {img?.confirmationVersion && row(t('merchAdmin.confirmationVersion'), img.confirmationVersion, 'merch-confirmation-version')}
                {img?.people === 'product_models' && row(t('merchAdmin.consentRef'), img?.consentRef || t('merchAdmin.notRecorded'), 'merch-consent-ref')}
                {img?.licenceRef && row(t('merchAdmin.licenceRef'), img.licenceRef, 'merch-licence-ref')}
                {img?.people === 'product_models' && row(t('merchAdmin.peopleConfirmed'), confirmedBy(img?.peopleConfirmedBy, img?.peopleConfirmedByName, img?.peopleConfirmedAt), 'merch-people-confirmed')}
                {row(t('merchAdmin.people'), [
                  banner.createdBy && `${t('merchAdmin.createdBy')}: ${person(banner.createdBy, banner.createdByName)}`,
                  banner.submittedBy && `${t('merchAdmin.submittedBy')}: ${person(banner.submittedBy, banner.submittedByName)}`,
                  banner.approvedBy && `${t('merchAdmin.approvedBy')}: ${person(banner.approvedBy, banner.approvedByName)}`,
                ].filter(Boolean).join(' · ') || '—')}
              </dl>
            </CardContent>
          </Card>
        </div>

        <Card className="self-start">
          <CardHeader><h2 className="font-semibold">{t('merchAdmin.actions')}</h2></CardHeader>
          <CardContent className="space-y-3">
            {!canApproveScope && <p className="rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] p-3 text-sm" data-testid="merch-no-approve">{t('merchAdmin.noApprove')}</p>}
            {decideBlocked && <p id={ownHintId} className="rounded-[var(--radius-md)] bg-[var(--color-bg-secondary)] p-3 text-sm" data-testid="merch-own-item">{t(own === 'worked' ? 'merchAdmin.ownWork' : 'merchAdmin.ownItem')}</p>}
            <div className="flex flex-wrap gap-2">
              {showDecide && (
                <>
                  <Button size="sm" disabled={decideBlocked || !allowed('approve')} aria-describedby={decideBlocked ? ownHintId : undefined} onClick={() => setDialog('approve')} data-testid="merch-approve">{t('merchAdmin.approve')}</Button>
                  <Button size="sm" variant="secondary" disabled={decideBlocked || !allowed('reject')} aria-describedby={decideBlocked ? ownHintId : undefined} onClick={() => setDialog('reject')} data-testid="merch-reject">{t('merchAdmin.reject')}</Button>
                </>
              )}
              {allowed('submit') && <Button size="sm" loading={busy} onClick={() => void simple(() => bannersApi.adminSubmit(token!, banner.id), 'merchAdmin.done.sent')} data-testid="merch-submit">{t('merch.send')}</Button>}
              {allowed('end') && <Button size="sm" variant="secondary" onClick={() => setDialog('end')} data-testid="merch-end">{t('merchAdmin.end')}</Button>}
              {allowed('position') && <Button size="sm" variant="secondary" onClick={() => setDialog('position')} data-testid="merch-set-position">{t('merchAdmin.setPosition')}</Button>}
              {allowed('edit') && banner.origin === 'staff' && <Button size="sm" variant="secondary" onClick={() => onEdit(banner.id)} data-testid="merch-edit">{t('merch.action.edit')}</Button>}
              {allowed('withdraw') && banner.origin === 'staff' && <Button size="sm" variant="ghost" onClick={() => setDialog('withdraw')} data-testid="merch-withdraw">{t('merch.action.withdraw')}</Button>}
            </div>
            {!showDecide && !(banner.allowedActions ?? []).length && <p className="text-sm text-[var(--color-fg-quaternary)]" data-testid="merch-no-actions">{t('merchAdmin.noActions')}</p>}
          </CardContent>
        </Card>
      </div>

      {history.length > 0 && (
        <Card>
          <CardHeader><h2 className="font-semibold">{t('merchAdmin.history')}</h2></CardHeader>
          <CardContent>
            <ol className="space-y-3" data-testid="merch-history">
              {history.map((h, i) => {
                const verb = String(h.action ?? '').replace(/^shop_banner\./, '');
                const reason = typeof h.after?.reason === 'string' ? h.after.reason : null;
                return (
                  <li key={h.id ?? i} className="border-l-2 border-[var(--color-border-secondary)] pl-3 text-sm [overflow-wrap:anywhere]">
                    <p className="font-medium">{t(HIST_KEY[verb] ?? 'merchAdmin.hist.other')}</p>
                    <p className="text-xs text-[var(--color-fg-quaternary)]">{eatDateTime(h.at ?? h.createdAt, locale)} · {h.actorName || h.actor || '—'}</p>
                    {reason && <p className="mt-1 text-[var(--color-fg-secondary)]">{reason}</p>}
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      )}

      {dialog === 'approve' && <ApproveDialog banner={banner} onClose={() => setDialog(null)} onDone={b => finish('merchAdmin.done.approved', b)} onStale={stale} />}
      {dialog === 'reject' && <RejectDialog banner={banner} onClose={() => setDialog(null)} onDone={b => finish('merchAdmin.done.rejected', b)} onStale={stale} />}
      {dialog === 'end' && <EndDialog banner={banner} onClose={() => setDialog(null)} onDone={b => finish('merchAdmin.done.ended', b)} />}
      {dialog === 'position' && <PositionDialog banner={banner} onClose={() => setDialog(null)} onDone={b => finish('merchAdmin.done.position', b)} />}
      <Dialog open={dialog === 'withdraw'} onClose={() => setDialog(null)} title={t('merch.withdrawBanner.title')} description={t('merch.withdraw.body')} size="sm">
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setDialog(null)}>{t('merch.withdraw.keep')}</Button>
          <Button variant="destructive" loading={busy} onClick={() => void simple(() => bannersApi.adminWithdraw(token!, banner.id), 'merch.withdrawn')} data-testid="merch-withdraw-confirm">{t('merch.withdraw.confirm')}</Button>
        </div>
      </Dialog>
    </div>
  );
}

function useAction(onDone: (b: ShopBanner) => void, onStale?: () => void) {
  const { t } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<ShopBanner>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { onDone(await fn()); }
    catch (err) {
      // H2: it changed after the reviewer opened it: close, reload and say so (never decide on what wasn't seen).
      if (errorCodeOf(err) === 'banner_changed' && onStale) { onStale(); return; }
      setError(t(adminErrorKey(err))); setBusy(false);
    }
  };
  return { busy, error, run };
}
const footer = 'flex flex-wrap justify-end gap-2 border-t border-[var(--color-border-secondary)] pt-4';

function ApproveDialog({ banner, onClose, onDone, onStale }: { banner: ShopBanner; onClose: () => void; onDone: (b: ShopBanner) => void; onStale: () => void }) {
  const { token, t } = useApp();
  const [checks, setChecks] = useState<string[]>([]);
  const { busy, error, run } = useAction(onDone, onStale);
  const all = REVIEW_CHECKS.every(c => checks.includes(c));
  return (
    <Dialog open onClose={onClose} title={t('merchAdmin.approve')} description={t('merchAdmin.approveHint')} size="md">
      <form onSubmit={e => { e.preventDefault(); if (all && token) void run(() => bannersApi.adminApprove(token, banner, REVIEW_CHECKS)); }} className="space-y-3" data-testid="merch-approve-dialog">
        {error && <Alert tone="error">{error}</Alert>}
        <fieldset className="flex flex-col">
          <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('merchAdmin.checklist')}</legend>
          {REVIEW_CHECKS.map(c => (
            <Checkbox key={c} checked={checks.includes(c)} onChange={e => setChecks(cur => (e.target.checked ? [...cur, c] : cur.filter(x => x !== c)))} label={t(CHECK_KEY[c])} data-testid={`merch-check-${c}`} />
          ))}
        </fieldset>
        <div className={footer}>
          <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={!all} loading={busy} data-testid="merch-approve-confirm">{t('merchAdmin.approve')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function RejectDialog({ banner, onClose, onDone, onStale }: { banner: ShopBanner; onClose: () => void; onDone: (b: ShopBanner) => void; onStale: () => void }) {
  const { token, t } = useApp();
  const [code, setCode] = useState<RejectCode | null>(null);
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction(onDone, onStale);
  const n = note.trim().length;
  const noteNeeded = code === 'other';
  const noteOk = noteNeeded ? n >= NOTE_MIN : n === 0 || n >= NOTE_MIN;
  const ok = !!code && noteOk;
  return (
    <Dialog open onClose={onClose} title={t('merchAdmin.reject')} description={t('merchAdmin.reason.noteHint')} size="md">
      <form onSubmit={e => { e.preventDefault(); if (ok && code && token) void run(() => bannersApi.adminReject(token, banner, code, note)); }} className="space-y-3" data-testid="merch-reject-dialog">
        {error && <Alert tone="error">{error}</Alert>}
        <fieldset className="flex flex-col">
          <legend className="text-sm font-medium text-[var(--color-fg-secondary)]">{t('merchAdmin.reason')}<span aria-hidden="true" className="text-[var(--color-error-600)]"> *</span></legend>
          {REJECT_CODES.map(r => <Radio key={r} name="merch-reject-reason" checked={code === r} onChange={() => setCode(r)} label={t(REJECT_KEY[r])} data-testid={`merch-reason-${r}`} />)}
        </fieldset>
        <Field label={t('merchAdmin.reason.note')} hint={fmt(t('merchAdmin.noteLength'), { min: NOTE_MIN, max: NOTE_MAX })} required={noteNeeded}
          error={n > 0 && !noteOk ? fmt(t('merchAdmin.noteLength'), { min: NOTE_MIN, max: NOTE_MAX }) : undefined}>
          <Textarea rows={3} value={note} onChange={e => setNote(e.target.value)} maxLength={NOTE_MAX} data-testid="merch-reject-note" />
        </Field>
        <div className={footer}>
          <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="destructive" disabled={!ok} loading={busy} data-testid="merch-reject-confirm">{t('merchAdmin.reject')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function EndDialog({ banner, onClose, onDone }: { banner: ShopBanner; onClose: () => void; onDone: (b: ShopBanner) => void }) {
  const { token, t } = useApp();
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction(onDone);
  const ok = reason.trim().length >= NOTE_MIN;
  return (
    <Dialog open onClose={onClose} title={t('merch.endBanner.title')} description={t('merchAdmin.end.bannerHint')} size="md">
      <form onSubmit={e => { e.preventDefault(); if (ok && token) void run(() => bannersApi.adminEnd(token, banner.id, reason.trim())); }} className="space-y-3" data-testid="merch-end-dialog">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label={t('merchAdmin.reason')} hint={`${t('merchAdmin.reason.noteHint')} ${fmt(t('merchAdmin.noteLength'), { min: NOTE_MIN, max: NOTE_MAX })}`} required>
          <Textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} maxLength={NOTE_MAX} data-testid="merch-end-reason" />
        </Field>
        <div className={footer}>
          <Button type="button" variant="secondary" onClick={onClose}>{t('merch.withdraw.keep')}</Button>
          <Button type="submit" variant="destructive" disabled={!ok} loading={busy} data-testid="merch-end-confirm">{t('merchAdmin.end')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function PositionDialog({ banner, onClose, onDone }: { banner: ShopBanner; onClose: () => void; onDone: (b: ShopBanner) => void }) {
  const { token, t } = useApp();
  const [value, setValue] = useState(banner.position == null ? '' : String(banner.position));
  const { busy, error, run } = useAction(onDone);
  const n = Number(value);
  const ok = value.trim() === '' || (Number.isInteger(n) && n >= 0 && n <= 9999);
  return (
    <Dialog open onClose={onClose} title={t('merchAdmin.setPosition')} description={t('merchAdmin.positionHint')} size="sm">
      <form onSubmit={e => { e.preventDefault(); if (ok && token) void run(() => bannersApi.adminPosition(token, banner.id, value.trim() === '' ? null : n)); }} className="space-y-3" data-testid="merch-position-dialog">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label={t('merchAdmin.col.position')} hint={t('merchAdmin.positionEmpty')} error={!ok ? t('merchAdmin.positionRange') : undefined}>
          <Input type="number" min={0} max={9999} step={1} value={value} onChange={e => setValue(e.target.value)} data-testid="merch-position-input" />
        </Field>
        <div className={footer}>
          <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={!ok} loading={busy} data-testid="merch-position-save">{t('merchAdmin.save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
