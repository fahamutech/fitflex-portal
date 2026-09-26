'use client';
// Message templates in the Communication Center: FitFlex's ready-made
// messages (read-only; gyms copy them) and a gym's own. The list, one
// template's preview per language, the editor, the picker used while writing
// a message, and the English/Swahili text fields shared with the composer.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileText, Plus } from 'lucide-react';
import { useApp } from '../../app/providers';
import {
  api, CommsContent, CommsDeepLink, CommsLocale, CommsPurpose, CommsScope, CommsTemplate, CommsTemplateDraft,
  CommsTemplateGroup, CommsTemplatePreview, CommsText,
} from '@/lib/api';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Segmented, Spinner } from './shared';
import { ConfirmDialog, Dialog } from './dialog';
import {
  BODY_MAX, DEEP_LINKS, LOCALES, MessageCard, PURPOSES, PushCard, SENDER_VARIABLES, T, TITLE_MAX, VARIABLES,
  errorText, fill, textOk,
} from './communication-shared';

export const GROUPS: CommsTemplateGroup[] = ['membership', 'payment', 'marketing', 'engagement', 'general'];

/** FitFlex templates are named in the portal's language; gym templates by what the owner called them. */
export function templateName(t: T, tpl: CommsTemplate) {
  return (tpl.system && t(`comms.tpl.${tpl.key}`)) || tpl.name;
}

const textIn = (tpl: CommsTemplate, lang: CommsLocale): CommsText =>
  tpl.bodies[lang] ?? Object.values(tpl.bodies)[0] ?? { title: '', body: '' };

/**
 * A message started from [tpl]: its text in [lang] (or a language it has) as
 * the main version, its other language as a translation. Offer values
 * already typed in are kept.
 */
export function contentFromTemplate(tpl: CommsTemplate, lang: CommsLocale, prev?: CommsContent): CommsContent {
  const main = tpl.bodies[lang] ? lang : (Object.keys(tpl.bodies)[0] as CommsLocale | undefined) ?? 'en';
  const text = tpl.bodies[main] ?? { title: '', body: '' };
  const translations: CommsContent['translations'] = {};
  for (const l of LOCALES) if (l !== main && tpl.bodies[l]) translations[l] = { ...tpl.bodies[l]! };
  return {
    title: text.title, body: text.body, ctaLabel: text.ctaLabel ?? '', deepLink: tpl.deepLink,
    locale: main, translations,
    offerName: prev?.offerName, discount: prev?.discount, amountTzs: prev?.amountTzs,
  };
}

// ── English / Swahili text fields ─────────────────────────────────────────
export function BilingualText({ t, texts, main, lang, setLang, onChange, onRemove, testPrefix = 'msg' }: {
  t: T;
  texts: Partial<Record<CommsLocale, CommsText>>;
  /** Required language; null when either one will do (template editor). */
  main: CommsLocale | null;
  lang: CommsLocale;
  setLang: (l: CommsLocale) => void;
  onChange: (l: CommsLocale, text: CommsText) => void;
  onRemove?: (l: CommsLocale) => void;
  testPrefix?: string;
}) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const text = texts[lang] ?? { title: '', body: '', ctaLabel: '' };
  const set = (patch: Partial<CommsText>) => onChange(lang, { ...text, ...patch });
  const optional = main != null && lang !== main;
  const written = Boolean(text.title.trim() || text.body.trim());

  function insertVariable(v: string) {
    const el = bodyRef.current;
    const token = `{{${v}}}`;
    const start = el?.selectionStart ?? text.body.length;
    const end = el?.selectionEnd ?? text.body.length;
    set({ body: text.body.slice(0, start) + token + text.body.slice(end) });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented className="w-fit" value={lang} onChange={l => setLang(l as CommsLocale)}
          options={LOCALES.map(l => [l, `${t(`comms.lang.${l}`)}${main === l ? ` · ${t('comms.lang.main')}` : ''}${texts[l]?.title.trim() ? ' ✓' : ''}`])} />
        {optional && written && onRemove && (
          <Button size="sm" variant="ghost" onClick={() => onRemove(lang)} data-testid={`${testPrefix}-remove-translation`}>{t('comms.lang.remove')}</Button>
        )}
      </div>
      {optional && <p className="text-xs text-[var(--color-fg-quaternary)]">{fill(t('comms.lang.optional'), { lang: t(`comms.lang.${lang}`) })}</p>}
      <Field label={t('comms.msg.title')} hint={`${text.title.length}/${TITLE_MAX}`} error={text.title.length > TITLE_MAX ? fill(t('comms.msg.tooLong'), { n: TITLE_MAX }) : undefined}>
        <Input value={text.title} placeholder={t('comms.msg.titleHint')} onChange={e => set({ title: e.target.value })} data-testid={`${testPrefix}-title-${lang}`} />
      </Field>
      <Field label={t('comms.msg.body')} hint={`${text.body.length}/${BODY_MAX}`} error={text.body.length > BODY_MAX ? fill(t('comms.msg.tooLong'), { n: BODY_MAX }) : undefined}>
        <textarea ref={bodyRef} className="ui-input" rows={5} value={text.body} placeholder={t('comms.msg.bodyHint')}
          onChange={e => set({ body: e.target.value })} data-testid={`${testPrefix}-body-${lang}`} />
      </Field>
      {written && !textOk(text, false) && <Alert tone="warning">{t('comms.lang.incomplete')}</Alert>}
      <div>
        <p className="mb-1 text-xs text-[var(--color-fg-quaternary)]">{t('comms.msg.personalise')}</p>
        <div className="flex flex-wrap gap-2">
          {VARIABLES.map(v => <Button key={v} size="sm" variant="secondary" onClick={() => insertVariable(v)} data-testid={`${testPrefix}-var-${v}`}>{t(`comms.var.${v}`)}</Button>)}
        </div>
      </div>
      <Field label={t('comms.msg.buttonLabel')}>
        <Input value={text.ctaLabel ?? ''} placeholder={t('comms.msg.buttonHint')} maxLength={25} onChange={e => set({ ctaLabel: e.target.value })} data-testid={`${testPrefix}-cta-${lang}`} />
      </Field>
    </div>
  );
}

// ── list (Templates tab) ──────────────────────────────────────────────────
export function TemplatesTab({ scope, token, t, gymId, onOpen, onNew }: {
  scope: CommsScope; token: string; t: T; gymId?: string; onOpen: (id: string) => void; onNew?: () => void;
}) {
  const [templates, setTemplates] = useState<CommsTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<CommsTemplateGroup | ''>('');

  const load = useCallback(() => {
    api.commsTemplates(token, scope, { gymId: scope === 'owner' ? gymId : undefined })
      .then(r => { setTemplates(r.templates); setError(null); })
      .catch(e => setError(errorText(t, e)));
  }, [token, scope, gymId, t]);
  useEffect(() => { load(); }, [load]);

  if (!templates) return error ? <Alert tone="error">{error}</Alert> : <Spinner />;
  const shown = templates.filter(x => !group || x.group === group);
  return (
    <div className="space-y-3" data-testid="templates">
      <p className="text-sm text-[var(--color-fg-tertiary)]">{t(scope === 'owner' ? 'comms.tpl.intro' : 'comms.tpl.introAdmin')}</p>
      <div className="flex flex-wrap items-center gap-2">
        {(['', ...GROUPS] as const).map(g => (
          <Button key={g || 'all'} size="sm" variant={group === g ? 'primary' : 'secondary'} onClick={() => setGroup(g)} data-testid={`tpl-filter-${g || 'all'}`}>
            {g ? t(`comms.group.${g}`) : t('comms.filter.all')}
          </Button>
        ))}
        <span className="flex-1" />
        {onNew && <Button size="sm" onClick={onNew} data-testid="tpl-new"><Plus className="h-4 w-4" />{t('comms.tpl.new')}</Button>}
      </div>
      <TemplateRows t={t} templates={shown} onOpen={x => onOpen(x.id)} />
    </div>
  );
}

function TemplateRows({ t, templates, onOpen }: { t: T; templates: CommsTemplate[]; onOpen: (tpl: CommsTemplate) => void }) {
  const { locale } = useApp();
  if (!templates.length) return <EmptyState title={t('comms.tpl.none')} />;
  return (
    <Card className="divide-y divide-[var(--color-border-secondary)]">
      {templates.map(x => (
        <button key={x.id} type="button" onClick={() => onOpen(x)} data-testid={`template-${x.system ? x.key : x.id}`}
          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-bg-secondary)]">
          <FileText className="h-4 w-4 shrink-0 text-[var(--color-fg-quaternary)]" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{templateName(t, x)}</p>
            <p className="truncate text-xs text-[var(--color-fg-quaternary)]">{textIn(x, locale).body}</p>
          </div>
          <Badge tone="gray">{t(`comms.group.${x.group}`)}</Badge>
          <Badge tone={x.system ? 'gray' : 'brand'}>{t(x.system ? 'comms.tplSource.fitflex' : 'comms.tplSource.gym')}</Badge>
        </button>
      ))}
    </Card>
  );
}

// ── picker (while writing a message) ──────────────────────────────────────
export function TemplatePicker({ open, onClose, scope, token, t, gymId, purpose, onPick }: {
  open: boolean; onClose: () => void; scope: CommsScope; token: string; t: T; gymId?: string;
  purpose?: CommsPurpose; onPick: (tpl: CommsTemplate) => void;
}) {
  const [templates, setTemplates] = useState<CommsTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<CommsTemplateGroup | ''>('');

  useEffect(() => {
    if (!open || templates) return;
    api.commsTemplates(token, scope, { gymId: scope === 'owner' ? gymId : undefined })
      .then(r => setTemplates([
        // The message's purpose first; the server's order otherwise.
        ...r.templates.filter(x => purpose && x.purpose === purpose),
        ...r.templates.filter(x => !purpose || x.purpose !== purpose),
      ]))
      .catch(e => setError(errorText(t, e)));
  }, [open, templates, token, scope, gymId, purpose, t]);

  return (
    <Dialog open={open} onClose={onClose} title={t('comms.tpl.pick')} size="lg">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {(['', ...GROUPS] as const).map(g => (
            <Button key={g || 'all'} size="sm" variant={group === g ? 'primary' : 'secondary'} onClick={() => setGroup(g)} data-testid={`tpl-group-${g || 'all'}`}>
              {g ? t(`comms.group.${g}`) : t('comms.filter.all')}
            </Button>
          ))}
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {templates ? <TemplateRows t={t} templates={templates.filter(x => !group || x.group === group)} onOpen={onPick} />
            : error ? <Alert tone="error">{error}</Alert> : <Spinner />}
        </div>
      </div>
    </Dialog>
  );
}

// ── one template: preview per language and channel ────────────────────────
function PreviewPanel({ t, preview, lang, setLang }: {
  t: T; preview: CommsTemplatePreview; lang: CommsLocale; setLang: (l: CommsLocale) => void;
}) {
  const langs = LOCALES.filter(l => preview.byLocale[l]);
  const shown = preview.byLocale[lang] ?? preview.byLocale[langs[0]];
  if (!shown) return null;
  return (
    <div className="space-y-4" data-testid="tpl-preview">
      {langs.length > 1 && <Segmented className="w-fit" value={lang} onChange={l => setLang(l as CommsLocale)} options={langs.map(l => [l, t(`comms.lang.${l}`)])} />}
      <p className="text-xs text-[var(--color-fg-quaternary)]">{fill(t('comms.preview.asSeenBy'), { name: preview.sampleMember })}</p>
      <div data-testid="tpl-preview-push">
        <p className="mb-1 text-xs font-semibold">{t('comms.channel.push')}</p>
        <PushCard sender={preview.senderName} title={shown.push.title} body={shown.push.body} />
        {shown.push.truncated && <p className="mt-1 text-xs text-[var(--color-fg-quaternary)]">{t('comms.tpl.pushCut')}</p>}
      </div>
      <div data-testid="tpl-preview-in-app">
        <p className="mb-1 text-xs font-semibold">{t('comms.channel.in_app')}</p>
        <MessageCard title={shown.in_app.title} body={shown.in_app.body} cta={shown.in_app.ctaLabel} />
      </div>
      <Alert tone="info">{t(preview.whatsapp.byLocale[lang]?.ready ? 'comms.tpl.whatsappReady' : 'comms.tpl.whatsappNotYet')}</Alert>
      {preview.needsValues.length > 0 && (
        <p className="text-xs text-[var(--color-fg-quaternary)]">{fill(t('comms.tpl.needsValues'), { names: preview.needsValues.map(v => t(`comms.var.${v}`)).join(', ') })}</p>
      )}
    </div>
  );
}

export function TemplateDetail({ scope, token, t, gymId, id, onBack, onUse, onEdit, onCopied }: {
  scope: CommsScope; token: string; t: T; gymId?: string; id: string;
  onBack: () => void; onUse: (id: string) => void; onEdit: (id: string) => void; onCopied: (id: string) => void;
}) {
  const { locale } = useApp();
  const [tpl, setTpl] = useState<CommsTemplate | null>(null);
  const [preview, setPreview] = useState<CommsTemplatePreview | null>(null);
  const [lang, setLang] = useState<CommsLocale>(locale);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    Promise.all([
      api.commsTemplate(token, scope, id),
      api.commsTemplatePreview(token, scope, id, scope === 'owner' && gymId ? { gymId } : {}),
    ]).then(([r, p]) => { setTpl(r.template); setPreview(p); setError(null); })
      .catch(e => setError(errorText(t, e)));
  }, [token, scope, id, gymId, t]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } catch (e) { setError(errorText(t, e)); } finally { setBusy(false); }
  }

  const back = <Button variant="secondary" onClick={onBack}><ArrowLeft className="h-4 w-4" />{t('comms.tpl.backToList')}</Button>;
  if (!tpl || !preview) return <div><PageHeader title={t('comms.tpl.title')} actions={back} />{error ? <Alert tone="error">{error}</Alert> : <Spinner />}</div>;
  const owner = scope === 'owner';
  return (
    <div data-testid="tpl-detail">
      <PageHeader title={templateName(t, tpl)} description={t(`comms.purpose.${tpl.purpose}`)} actions={back} />
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone={tpl.system ? 'gray' : 'brand'}>{t(tpl.system ? 'comms.tplSource.fitflex' : 'comms.tplSource.gym')}</Badge>
        <Badge tone="gray">{t(`comms.group.${tpl.group}`)}</Badge>
      </div>
      <Card className="p-5"><PreviewPanel t={t} preview={preview} lang={lang} setLang={setLang} /></Card>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => onUse(tpl.id)} data-testid="tpl-use">{t('comms.tpl.use')}</Button>
        {owner && tpl.system && (
          <Button variant="secondary" disabled={busy} data-testid="tpl-copy"
            onClick={() => act(async () => onCopied((await api.commsTemplateDuplicate(token, tpl.id, { gymId, name: templateName(t, tpl) })).template.id))}>
            {t('comms.tpl.copy')}
          </Button>
        )}
        {owner && !tpl.system && <>
          <Button variant="secondary" disabled={busy} onClick={() => onEdit(tpl.id)} data-testid="tpl-edit">{t('comms.tpl.edit')}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => setArchiving(true)} data-testid="tpl-archive">{t('comms.tpl.archive')}</Button>
        </>}
      </div>
      <ConfirmDialog
        open={archiving}
        onClose={() => setArchiving(false)}
        title={t('comms.tpl.archiveTitle')}
        description={t('comms.tpl.archiveBody')}
        confirmLabel={t('comms.yes')}
        cancelLabel={t('comms.keep')}
        busy={busy}
        onConfirm={() => act(async () => { await api.commsTemplateArchive(token, tpl.id); setArchiving(false); onBack(); })}
      />
    </div>
  );
}

// ── editor (a gym's own templates) ────────────────────────────────────────
export function TemplateEditor({ token, t, gymId, id, onBack, onSaved }: {
  token: string; t: T; gymId?: string; id?: string; onBack: () => void; onSaved: (id: string) => void;
}) {
  const { locale } = useApp();
  const [ready, setReady] = useState(!id);
  const [name, setName] = useState('');
  const [group, setGroup] = useState<CommsTemplateGroup>('general');
  const [purpose, setPurpose] = useState<CommsPurpose>('announcement');
  const [deepLink, setDeepLink] = useState<CommsDeepLink>('message');
  const [bodies, setBodies] = useState<Partial<Record<CommsLocale, CommsText>>>({});
  const [lang, setLang] = useState<CommsLocale>(locale);
  const [preview, setPreview] = useState<CommsTemplatePreview | null>(null);
  const [previewLang, setPreviewLang] = useState<CommsLocale>(locale);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!id) return;
    api.commsTemplate(token, 'owner', id).then(({ template: x }) => {
      setName(x.name); setGroup(x.group); setPurpose(x.purpose); setDeepLink(x.deepLink); setBodies(x.bodies);
      setReady(true);
    }).catch(e => setError(errorText(t, e)));
  }, [token, id, t]);

  const written = LOCALES.filter(l => bodies[l]?.title.trim() || bodies[l]?.body.trim());
  const valid = Boolean(name.trim()) && written.length > 0 && LOCALES.every(l => textOk(bodies[l], false));
  const draft = (): CommsTemplateDraft => ({
    ...(gymId && !id ? { gymId } : {}),
    name: name.trim(), group, purpose, deepLink,
    bodies: Object.fromEntries(written.map(l => {
      const b = bodies[l]!;
      return [l, { title: b.title.trim(), body: b.body.trim(), ...(b.ctaLabel?.trim() ? { ctaLabel: b.ctaLabel.trim() } : {}) }];
    })),
  });

  // Live preview of the unsaved template.
  useEffect(() => {
    if (!ready || !valid) { setPreview(null); return; }
    const timer = setTimeout(() => {
      api.commsTemplatePreviewNew(token, 'owner', { ...draft(), ...(gymId ? { gymId } : {}) }).then(setPreview).catch(() => setPreview(null));
    }, 500);
    return () => clearTimeout(timer);
  }, [ready, valid, token, gymId, name, group, purpose, deepLink, JSON.stringify(bodies)]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(null);
    try {
      if (id) {
        const { gymId: _ignored, ...patch } = draft();
        await api.commsTemplateUpdate(token, id, patch);
        onSaved(id);
      } else {
        onSaved((await api.commsTemplateCreate(token, draft())).template.id);
      }
    } catch (e) { setError(errorText(t, e)); } finally { inFlight.current = false; setBusy(false); }
  }

  const back = <Button variant="secondary" onClick={onBack}><ArrowLeft className="h-4 w-4" />{t('comms.tpl.backToList')}</Button>;
  if (!ready) return <div><PageHeader title={t('comms.tpl.edit')} actions={back} />{error ? <Alert tone="error">{error}</Alert> : <Spinner />}</div>;
  const usesOffer = written.some(l => SENDER_VARIABLES.some(v => `${bodies[l]!.title} ${bodies[l]!.body}`.includes(`{{${v}}}`)));
  return (
    <div data-testid="tpl-editor">
      <PageHeader title={t(id ? 'comms.tpl.edit' : 'comms.tpl.new')} actions={back} />
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card className="space-y-4 p-5">
          <Field label={t('comms.tpl.name')}>
            <Input value={name} maxLength={80} onChange={e => setName(e.target.value)} data-testid="tpl-name" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('comms.tpl.group')}>
              <select className="ui-input" value={group} onChange={e => setGroup(e.target.value as CommsTemplateGroup)} data-testid="tpl-group">
                {GROUPS.map(g => <option key={g} value={g}>{t(`comms.group.${g}`)}</option>)}
              </select>
            </Field>
            <Field label={t('comms.tpl.purpose')}>
              <select className="ui-input" value={purpose} onChange={e => setPurpose(e.target.value as CommsPurpose)} data-testid="tpl-purpose">
                {PURPOSES.map(p => <option key={p} value={p}>{t(`comms.purpose.${p}`)}</option>)}
              </select>
            </Field>
            <Field label={t('comms.msg.opens')}>
              <select className="ui-input" value={deepLink} onChange={e => setDeepLink(e.target.value as CommsDeepLink)} data-testid="tpl-link">
                {DEEP_LINKS.map(d => <option key={d} value={d}>{t(`comms.link.${d}`)}</option>)}
              </select>
            </Field>
          </div>
          <p className="text-xs text-[var(--color-fg-quaternary)]">{t('comms.tpl.bothLangs')}</p>
          <BilingualText t={t} texts={bodies} main={null} lang={lang} setLang={setLang} testPrefix="tpl"
            onChange={(l, x) => setBodies(b => ({ ...b, [l]: x }))} />
          {usesOffer && <p className="text-xs text-[var(--color-fg-quaternary)]">{t('comms.tpl.offerLater')}</p>}
        </Card>
        <div>
          <p className="mb-2 text-sm font-semibold">{t('comms.step.preview')}</p>
          {preview ? <PreviewPanel t={t} preview={preview} lang={previewLang} setLang={setPreviewLang} />
            : <p className="text-sm text-[var(--color-fg-quaternary)]">{t('comms.tpl.previewEmpty')}</p>}
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button disabled={!valid || busy} onClick={save} data-testid="tpl-save">{busy ? <Spinner className="h-4 w-4" /> : t('comms.tpl.save')}</Button>
      </div>
    </div>
  );
}
