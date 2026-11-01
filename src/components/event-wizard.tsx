'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type Bilingual, type EventDocument, type EventPatch, type EventsOptions } from '@/lib/api';
import {
  WIZARD_STEPS, canManageEvents, clockTime, docFromForm, emptyForm, errorBody, errorCode, errorKey, errorsByStep, eventDateTime, eventStatusOf, fieldId, fmt,
  formFromDoc, fullPayload, isEditableStatus, isFeatureOff, isForbidden, isPublishedLike, materialDiff, rejectReasonKey, serverErrors, stepKey, stepOfPath,
  stepPayload, trackEventsAnalytics, validateEvent, type Diff, type Errors, type EventForm, type WizardStep,
} from '@/lib/events';
import { Alert, Badge, Button, Card, CardContent, Checkbox, Field, PageHeader, Textarea, useToast } from '@/components/shared';
import { Stepper } from '@/components/stepper';
import { ConfirmDialog, Dialog, DialogFooter } from '@/components/dialog';
import { useOrganizer } from '@/components/organizer-context';
import { EventsUnavailable, OrganizerForbidden, PageError, PageLoading, useDocumentTitle } from '@/components/organizer/page-states';
import { LifecycleButtons, LifecycleDialogs, lifecycleActions, type LifecycleAction } from '@/components/event-lifecycle';
import { EventChangeLog } from '@/components/event-change-log';
import { EventViewTabs, OrganizerEventView, canSeeView, hasRegistrationData, type EventView } from '@/components/organizer/event-views';
import { BasicsStep } from '@/components/event-wizard-steps/basics';
import { VenueStep } from '@/components/event-wizard-steps/venue';
import { CategoriesStep } from '@/components/event-wizard-steps/categories';
import { TicketsStep } from '@/components/event-wizard-steps/tickets';
import { KitStep } from '@/components/event-wizard-steps/kit';
import { TermsStep } from '@/components/event-wizard-steps/terms';
import { ReviewStep } from '@/components/event-wizard-steps/review';
import { useApp } from '../../app/providers';

const AUTOSAVE_MS = 1500;
type LoadState = 'loading' | 'ready' | 'forbidden' | 'notfound' | 'off' | 'error';
type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

/**
 * The 7-step event form (spec §6.2, §7): `?event=new` creates the draft on the first valid title blur, drafts autosave
 * (1.5 s debounce, PATCH with `version`), published events save explicitly with the material-change dialog (§7.4).
 */
export function EventWizard({ eventId, initialStep, view, onBack, onView }: {
  eventId: string; initialStep?: string | null; view?: string | null; onBack: () => void; onView: (id: string, view: 'changes' | EventView | null) => void;
}) {
  const { t, token, locale } = useApp();
  const org = useOrganizer();
  const toast = useToast();
  const [id, setId] = useState<string | null>(eventId === 'new' ? null : eventId);
  const idRef = useRef<string | null>(id);
  const loadedId = useRef<string | null>(null);
  const [doc, setDoc] = useState<EventDocument | null>(null);
  const docRef = useRef<EventDocument | null>(null);
  const [form, setForm] = useState<EventForm>(() => emptyForm(org.organizer?.timezone));
  const formRef = useRef(form);
  const [loadState, setLoadState] = useState<LoadState>(eventId === 'new' ? 'ready' : 'loading');
  const startIndex = Math.max(0, WIZARD_STEPS.indexOf((initialStep ?? 'basics') as WizardStep));
  const [step, setStep] = useState(startIndex);
  const stepRef = useRef(step);
  const [attempted, setAttempted] = useState<Set<WizardStep>>(new Set());
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [serverErrs, setServerErrs] = useState<Errors>({});
  const [options, setOptions] = useState<EventsOptions | null>(null);
  const [permitOnFile, setPermitOnFile] = useState<boolean | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lifecycle, setLifecycle] = useState<LifecycleAction | null>(null);
  const [material, setMaterial] = useState<{ diffs: Diff[]; payload: Omit<EventPatch, 'version'> } | null>(null);
  const [noteEn, setNoteEn] = useState(''); const [noteSw, setNoteSw] = useState(''); const [ack, setAck] = useState(false);
  const [savingExplicit, setSavingExplicit] = useState(false);
  const versionRef = useRef(0);
  const dirtyRef = useRef<Set<WizardStep>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const creatingRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  formRef.current = form; docRef.current = doc; stepRef.current = step;

  const canManage = canManageEvents(org.organizer?.status, org.role);
  const status = doc?.status ?? 'draft';
  const readOnly = !canManage || !isEditableStatus(status);
  const autosaveOn = canManage && (!doc || status === 'draft') && saveState !== 'conflict';
  const pageTitle = doc?.title || form.title || t('events.wizard.newTitle');
  useDocumentTitle(pageTitle);

  // ── Load ──
  const load = useCallback(async (which: string) => {
    if (!token) return;
    setLoadState('loading');
    try {
      const next = await api.organizerEvent(token, which);
      versionRef.current = next.version;
      dirtyRef.current.clear();
      setDoc(next); setForm(formFromDoc(next)); setServerErrs({}); setSaveState('idle');
      setLoadState('ready');
    } catch (err) {
      if (isForbidden(err)) setLoadState('forbidden');
      else if (isFeatureOff(err)) setLoadState('off');
      else if (errorCode(err) === 'event_not_found' || (err instanceof ApiError && err.status === 404)) setLoadState('notfound');
      else setLoadState('error');
    }
  }, [token]);
  useEffect(() => {
    if (eventId === 'new' || loadedId.current === eventId) return;
    loadedId.current = eventId; idRef.current = eventId; setId(eventId);
    void load(eventId);
  }, [eventId, load]);
  useEffect(() => { api.eventsOptions().then(setOptions).catch(() => setOptions(null)); }, []);
  // Only the owner's persona may read /me/kyc; admins see no permit warning (the admin queue shows it anyway).
  const isOwner = org.role === 'owner';
  useEffect(() => {
    if (!token || !canManage || !isOwner) return;
    api.myKyc(token).then(k => setPermitOnFile(k.documents.some(d => d.requirementKey === 'event_permit' && d.hasFile && d.status !== 'rejected' && d.status !== 'superseded')))
      .catch(() => setPermitOnFile(null));
  }, [token, canManage, isOwner]);

  // ── Validation ──
  const allErrors = useMemo(() => ({ ...validateEvent(form), ...serverErrs }), [form, serverErrs]);
  const submitErrors = useMemo(() => ({ ...validateEvent(form, { forSubmit: true }), ...serverErrs }), [form, serverErrs]);
  const byStep = useMemo(() => errorsByStep(allErrors), [allErrors]);
  const firstInvalid = WIZARD_STEPS.findIndex(s => byStep[s] > 0);
  const maxReached = Math.max(step, firstInvalid === -1 ? WIZARD_STEPS.length - 1 : firstInvalid);
  const shownErrors = useMemo<Errors>(() => {
    const out: Errors = {};
    for (const [path, e] of Object.entries(allErrors)) if (attempted.has(stepOfPath(path)) || path in serverErrs) out[path] = e;
    return out;
  }, [allErrors, attempted, serverErrs]);

  // ── URL and focus follow the step ──
  const replaceUrl = useCallback((nextId: string | null, nextStep: number) => {
    const q = new URLSearchParams(window.location.search);
    q.set('event', nextId ?? 'new'); q.set('step', WIZARD_STEPS[nextStep]); q.delete('view');
    window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}`);
  }, []);
  const goTo = useCallback((index: number, focusPath?: string) => {
    const next = Math.max(0, Math.min(WIZARD_STEPS.length - 1, index));
    setStep(next); replaceUrl(idRef.current, next);
    setTimeout(() => {
      const el = focusPath ? document.getElementById(fieldId(focusPath)) : null;
      (el ?? headingRef.current)?.focus();
    }, 50);
  }, [replaceUrl]);

  // ── Saving ──
  const flush = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (!token) return false;
    if (!idRef.current) return createDraft();
    const steps = [...dirtyRef.current];
    if (!steps.length) return true;
    dirtyRef.current.clear();
    const payload = Object.assign({}, ...steps.map(s => stepPayload(formRef.current, s))) as Omit<EventPatch, 'version'>;
    // S5 §3.1: the payout schedule travels only while the event is a draft (published and later answer 409 payout_schedule_locked).
    if (docRef.current && docRef.current.status !== 'draft') delete payload.payoutSchedule;
    setSaveState('saving');
    try {
      const res = await api.patchOrganizerEvent(token, idRef.current, { version: versionRef.current, ...payload });
      versionRef.current = res.version;
      setDoc(d => (d ? { ...d, ...(payload as Partial<EventDocument>), version: res.version, updatedAt: res.updatedAt } : d));
      setServerErrs({}); setSaveState('saved'); setSavedAt(new Date());
      // The server words the refund policy: fetch its sentence after a save that carried the policy (S4 review item 15).
      if ('refundPolicy' in payload && idRef.current) {
        const savedId = idRef.current;
        api.organizerEvent(token, savedId).then(f => setDoc(d => (d && d.id === f.id ? { ...d, refundPolicy: f.refundPolicy } : d))).catch(() => undefined);
      }
      return true;
    } catch (err) {
      steps.forEach(s => dirtyRef.current.add(s));
      const code = errorCode(err);
      if (code === 'version_conflict') setSaveState('conflict');
      else {
        if (code === 'event_invalid') setServerErrs(serverErrors(errorBody<{ fields?: Array<{ path: string; code: string }> }>(err)?.fields));
        setSaveState('error');
      }
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void flush(); }, AUTOSAVE_MS);
  }, [flush]);
  const update = useCallback((patch: Partial<EventForm> | ((f: EventForm) => Partial<EventForm>)) => {
    setForm(f => ({ ...f, ...(typeof patch === 'function' ? patch(f) : patch) }));
    const s = WIZARD_STEPS[stepRef.current];
    dirtyRef.current.add(s === 'review' ? 'basics' : s);
    if (autosaveOn && idRef.current) schedule();
  }, [autosaveOn, schedule]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  async function createDraft(): Promise<boolean> {
    if (!token || idRef.current || creatingRef.current) return false;
    const title = formRef.current.title.trim();
    if (title.length < 3 || title.length > 80) return false;
    creatingRef.current = true;
    setSaveState('saving');
    try {
      const created = await api.createOrganizerEvent(token, { title });
      idRef.current = created.id; loadedId.current = created.id; versionRef.current = created.version; setId(created.id);
      replaceUrl(created.id, stepRef.current);
      const fresh = await api.organizerEvent(token, created.id).catch(() => null);
      if (fresh) setDoc(fresh);
      // Whatever was typed before the id existed goes up now.
      WIZARD_STEPS.forEach(s => { if (s !== 'review') dirtyRef.current.add(s); });
      creatingRef.current = false;
      return flush();
    } catch (err) {
      creatingRef.current = false;
      setSaveState('error');
      toast.error(t(errorKey(err)));
      return false;
    }
  }

  async function reloadDoc() {
    if (!idRef.current) return;
    await load(idRef.current);
  }

  // Published: explicit save with the material-change dialog (§7.4).
  async function saveChanges() {
    if (!token || !docRef.current || !idRef.current) return;
    if (Object.keys(allErrors).length) { setAttempted(new Set(WIZARD_STEPS)); toast.error(t('events.error.event_invalid')); return; }
    const payload = fullPayload(formRef.current);
    const diffs = materialDiff(docRef.current, payload);
    if (diffs.length) { setMaterial({ diffs, payload }); return; }
    await patchExplicit(payload);
  }
  async function patchExplicit(payload: Omit<EventPatch, 'version'>, changeNote?: Bilingual) {
    if (!token || !idRef.current) return;
    setSavingExplicit(true);
    try {
      const res = await api.patchOrganizerEvent(token, idRef.current, { version: versionRef.current, ...payload, ...(changeNote ? { changeNote } : {}) });
      versionRef.current = res.version;
      setMaterial(null); setNoteEn(''); setNoteSw(''); setAck(false);
      toast.success(t('events.saved.toast'));
      await reloadDoc();
    } catch (err) {
      const code = errorCode(err);
      if (code === 'version_conflict') setSaveState('conflict');
      else if (code === 'change_note_required') setMaterial({ diffs: materialDiff(docRef.current!, payload), payload });
      else if (code === 'event_invalid') { setServerErrs(serverErrors(errorBody<{ fields?: Array<{ path: string; code: string }> }>(err)?.fields)); setAttempted(new Set(WIZARD_STEPS)); }
      else toast.error(t(errorKey(err)));
    } finally { setSavingExplicit(false); }
  }

  // ── Steps ──
  function next() {
    const current = WIZARD_STEPS[step];
    if (byStep[current] > 0) {
      setAttempted(a => new Set(a).add(current));
      const firstPath = Object.keys(allErrors).find(p => stepOfPath(p) === current);
      if (firstPath) setTimeout(() => document.getElementById(fieldId(firstPath))?.focus(), 0);
      return;
    }
    if (autosaveOn) void flush();
    goTo(step + 1);
  }
  function submit() {
    if (Object.keys(submitErrors).length) { setAttempted(new Set(WIZARD_STEPS)); goTo(WIZARD_STEPS.length - 1); return; }
    setSubmitOpen(true);
  }
  async function doSubmit() {
    if (!token) return;
    setSubmitting(true);
    try {
      const ok = idRef.current ? await flush() : await createDraft();
      if (!ok && saveState === 'conflict') { setSubmitOpen(false); return; }
      if (!idRef.current) return;
      await api.organizerEventAction(token, idRef.current, 'submit');
      trackEventsAnalytics('organizer_event_submitted', { eventId: idRef.current });
      setSubmitOpen(false);
      toast.success(t('events.submitted.toast'));
      await reloadDoc();
    } catch (err) {
      const code = errorCode(err);
      if (code === 'event_invalid') { setServerErrs(serverErrors(errorBody<{ fields?: Array<{ path: string; code: string }> }>(err)?.fields)); setAttempted(new Set(WIZARD_STEPS)); setSubmitOpen(false); goTo(WIZARD_STEPS.length - 1); }
      else toast.error(t(errorKey(err)));
    } finally { setSubmitting(false); }
  }
  async function runLifecycle(action: LifecycleAction, body?: { reason?: string; note?: Bilingual }) {
    if (!token || !idRef.current) return;
    if (action === 'delete') { await api.deleteOrganizerEvent(token, idRef.current); toast.success(t('events.action.done')); onBack(); return; }
    await api.organizerEventAction(token, idRef.current, action, body);
    toast.success(t('events.action.done'));
    await reloadDoc();
  }

  // ── Render ──
  if (loadState === 'off') return <EventsUnavailable />;
  if (loadState === 'forbidden') return <OrganizerForbidden backHref="/organizer/events" />;
  if (loadState === 'notfound') return <OrganizerForbidden backHref="/organizer/events" />;
  if (loadState === 'error') return <PageError onRetry={() => idRef.current && void load(idRef.current)} />;
  if (loadState === 'loading') return <PageLoading />;
  if (view === 'changes' && doc) return <EventChangeLog doc={doc} onBack={() => onView(doc.id, null)} />;
  // S3 §6.3: the roster and orders of this event, role-gated (§6.1); an unknown role falls back to the details.
  if ((view === 'registrations' || view === 'orders' || view === 'finance' || view === 'kit' || view === 'bibs' || view === 'export' || view === 'results') && doc) {
    if (!canSeeView(view, org.role)) return <OrganizerForbidden backHref="/organizer/events" />;
    return <OrganizerEventView doc={doc} view={view} role={org.role} onView={v => onView(doc.id, v)} onBack={onBack} />;
  }

  const st = eventStatusOf(status);
  const current = WIZARD_STEPS[step];
  const reviewDoc = docFromForm(form, doc ?? {});
  const actions = lifecycleActions(doc?.allowedActions, canManage);
  const indicator = saveState === 'saving' ? t('events.wizard.saving')
    : saveState === 'saved' && savedAt ? fmt(t('events.wizard.savedAt'), { time: clockTime(savedAt, locale) })
    : saveState === 'error' ? t('events.wizard.notSaved') : '';
  const stepProps = { form, update, errors: shownErrors, savedPolicy: doc?.refundPolicy ?? null, readOnly, payoutLocked: !!doc && status !== 'draft', token: token ?? '', options, onTitleBlur: () => { if (!idRef.current && autosaveOn) void createDraft(); } };

  return (
    <div className="space-y-4" data-testid="event-wizard" data-event-id={id ?? 'new'}>
      <PageHeader
        title={pageTitle}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={st.tone}>{t(st.key)}</Badge>
            <span role="status" aria-live="polite" className="text-sm text-[var(--color-fg-quaternary)]" data-testid="save-indicator">
              {indicator}{saveState === 'error' && <> — <button type="button" className="underline" onClick={() => void flush()} data-testid="save-retry">{t('events.wizard.retry')}</button></>}
            </span>
          </span>
        }
        actions={
          <>
            {doc && (isPublishedLike(status) || status === 'completed' || status === 'cancelled' || status === 'archived' || doc.changeLogCount > 0) && (
              <Button variant="ghost" size="sm" onClick={() => onView(doc.id, 'changes')} data-testid="open-change-log">{t('events.changes.link')}</Button>
            )}
            <LifecycleButtons actions={actions} onPick={setLifecycle} />
            <Button variant="ghost" size="sm" onClick={onBack}>{t('events.wizard.back')}</Button>
          </>
        }
      />

      {saveState === 'conflict' && (
        <div data-testid="version-conflict">
          <Alert tone="warning">
            {t('events.wizard.conflict')} <Button variant="link" size="sm" onClick={() => void reloadDoc()} data-testid="conflict-reload">{t('events.wizard.reload')}</Button>
          </Alert>
        </div>
      )}
      {doc?.rejection && status === 'draft' && (
        <div data-testid="rejected-banner"><Alert tone="warning">{fmt(t('events.rejected.banner'), { reason: t(rejectReasonKey(doc.rejection.reason)), note: doc.rejection.note ?? '' })}</Alert></div>
      )}
      {doc && <EventViewTabs view="details" role={org.role} onView={v => onView(doc.id, v)} published={hasRegistrationData(doc)} eventId={doc.id} status={doc.status} />}
      {status === 'submitted' && <div data-testid="submitted-card"><Alert tone="info">{t('events.submitted.card')}</Alert></div>}
      {doc && !isEditableStatus(status) && status !== 'submitted' && <Alert tone="info">{fmt(t('events.wizard.readOnly'), { status: t(st.key) })}</Alert>}
      {doc && status === 'published' && doc.registrationClosesAt && <Alert tone="info">{fmt(t('events.autoHint.regCloses'), { when: eventDateTime(doc.registrationClosesAt, doc.timezone, locale, doc.timezoneAbbr) })}</Alert>}

      <Stepper
        steps={WIZARD_STEPS.map(s => ({ key: s, label: t(stepKey(s)), ariaSuffix: attempted.has(s) && byStep[s] > 0 ? t('events.wizard.hasErrors') : undefined }))}
        current={step} maxReached={maxReached} onStep={i => goTo(i)}
      />

      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-[var(--color-fg-primary)] outline-none" data-testid="step-heading">{t(stepKey(current))}</h2>
            {attempted.has(current) && byStep[current] > 0 && <Badge tone="danger">{fmt(t('events.wizard.errorsBadge'), { n: byStep[current] })}</Badge>}
          </div>
          {current === 'basics' && <BasicsStep {...stepProps} />}
          {current === 'venue' && <VenueStep {...stepProps} />}
          {current === 'categories' && <CategoriesStep {...stepProps} />}
          {current === 'tickets' && <TicketsStep {...stepProps} />}
          {current === 'kit' && <KitStep {...stepProps} />}
          {current === 'terms' && <TermsStep {...stepProps} />}
          {current === 'review' && (
            <ReviewStep doc={reviewDoc} errors={status === 'draft' ? submitErrors : allErrors} onEdit={(s, path) => goTo(WIZARD_STEPS.indexOf(s), path)} permitOnFile={permitOnFile} confirmed={confirmed} setConfirmed={setConfirmed} readOnly={readOnly || status !== 'draft'} />
          )}
        </CardContent>
      </Card>

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-[var(--color-border-canvas)] bg-[var(--color-bg-canvas)] px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0" data-testid="wizard-footer">
        <Button variant="ghost" className="flex-1 sm:flex-none" disabled={step === 0} onClick={() => goTo(step - 1)} data-testid="wizard-prev">{t('events.wizard.prev')}</Button>
        <div className="flex-1 sm:flex-none" />
        {!readOnly && status === 'draft' && <Button variant="secondary" className="flex-1 sm:flex-none" onClick={() => void flush()} loading={saveState === 'saving'} data-testid="wizard-save-draft">{t('events.wizard.saveDraft')}</Button>}
        {!readOnly && status === 'published' && <Button variant="secondary" className="flex-1 sm:flex-none" onClick={() => void saveChanges()} loading={savingExplicit} data-testid="wizard-save-changes">{t('events.wizard.saveChanges')}</Button>}
        {current !== 'review'
          ? <Button className="flex-1 sm:flex-none" onClick={next} data-testid="wizard-next">{t('events.wizard.next')}</Button>
          : !readOnly && status === 'draft' && <Button className="flex-1 sm:flex-none" disabled={!confirmed} onClick={submit} data-testid="wizard-submit">{t('events.review.submit')}</Button>}
      </div>

      <ConfirmDialog open={submitOpen} onClose={() => setSubmitOpen(false)} onConfirm={() => void doSubmit()} busy={submitting} tone="primary"
        title={t('events.review.submitTitle')} description={t('events.review.submitBody')} confirmLabel={t('events.review.submit')} />
      <LifecycleDialogs action={lifecycle} onClose={() => setLifecycle(null)} run={runLifecycle} />

      <Dialog open={!!material} onClose={() => setMaterial(null)} title={t('events.material.title')} description={t('events.material.body')} size="lg">
        <div className="space-y-4" data-testid="material-dialog">
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-fg-secondary)]">
            {(material?.diffs ?? []).map(d => <li key={d.path}><span className="font-medium">{d.path}</span>: {String(d.before ?? '—')} → {String(d.after ?? '—')}</li>)}
          </ul>
          <Field label={t('events.material.noteEn')} required><Textarea rows={3} value={noteEn} onChange={e => setNoteEn(e.target.value)} maxLength={500} data-testid="material-note-en" /></Field>
          <Field label={t('events.material.noteSw')} required><Textarea rows={3} value={noteSw} onChange={e => setNoteSw(e.target.value)} maxLength={500} data-testid="material-note-sw" /></Field>
          <Checkbox label={t('events.material.ack')} checked={ack} onChange={e => setAck(e.target.checked)} data-testid="material-ack" />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setMaterial(null)} disabled={savingExplicit}>{t('common.cancel')}</Button>
          <Button loading={savingExplicit} disabled={!ack || !noteEn.trim() || !noteSw.trim()} onClick={() => material && void patchExplicit(material.payload, { en: noteEn.trim(), sw: noteSw.trim() })} data-testid="material-save">{t('events.material.save')}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
