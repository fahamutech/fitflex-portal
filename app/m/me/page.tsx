'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../providers';
import { LoadError, Loading, MemberFrame, PageTitle, card, ghostBtn, input, muted, primaryBtn } from '@/components/member/member-frame';
import { errorKey } from '@/components/member/pay-panel';
import { fmt } from '@/components/member/member-shared';
import { clearSession, localText, MEMBER_ROUTES, MemberApiError, memberApi, memberApi3, type CommsPrefs, type MemberCode, type MeResponse } from '@/lib/member-api';
import type { MessageKey } from '@/lib/i18n';

export default function MemberMePage() {
  return <MemberFrame testId="member-me-page">{() => <Me />}</MemberFrame>;
}

type PrefKey = 'inAppMarketing' | 'pushMarketing' | 'smsMarketing' | 'whatsappMarketing';

function Me() {
  const { t, locale, setLocale } = useApp();
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [prefs, setPrefs] = useState<CommsPrefs | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<MemberCode | null>(null);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<MemberCode | null>(null);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [m, p] = await Promise.all([memberApi.me(), memberApi3.commsPrefs().catch(() => null)]);
      setMe(m); setPrefs(p); setName(m.user.displayName || m.user.name || ''); setEmail(m.user.email || ''); setState('ready');
    } catch { setState('error'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (state === 'loading') return <Loading />;
  if (state === 'error' || !me) return <LoadError onRetry={load} />;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setSaved(false); setError(null);
    try { await memberApi3.saveProfile({ displayName: name.trim(), email: email.trim() }); setSaved(true); }
    catch (err) { setError(err instanceof MemberApiError ? err.code : 'unknown'); }
    finally { setSaving(false); }
  }
  async function togglePref(k: PrefKey, v: boolean) {
    if (!prefs) return;
    const before = prefs;
    setPrefs({ ...prefs, [k]: v });
    try { await memberApi3.setCommsPrefs({ [k]: v }); } catch { setPrefs(before); }
  }
  function chooseLanguage(l: 'en' | 'sw') {
    setLocale(l);
    void memberApi3.setCommsPrefs({ locale: l }).catch(() => { /* the web choice still applies */ });
  }
  const signOut = () => { clearSession(); router.replace(MEMBER_ROUTES.signin); };
  const word = t('member.me.deleteWord');
  async function deleteAccount() {
    if (typed.trim().toUpperCase() !== word) return;
    setDeleting(true); setDeleteError(null);
    try { await memberApi3.deleteAccount(); clearSession(); router.replace(MEMBER_ROUTES.signin); }
    catch (err) {
      // Already gone (a retry whose first answer was lost): treat as done.
      if (err instanceof MemberApiError && err.status === 404) { clearSession(); router.replace(MEMBER_ROUTES.signin); return; }
      setDeleteError(err instanceof MemberApiError ? err.code : 'unknown');
      // The server explains why it can't delete yet (an open paid order, a gym it owns…) in both languages: show that.
      setDeleteMessage(err instanceof MemberApiError ? localText(err.serverMessage ? { en: err.serverMessage.en, sw: err.serverMessage.sw } : null, locale) : null);
      setDeleting(false);
    }
  }

  const prefRows: Array<[PrefKey, MessageKey, boolean]> = prefs ? [
    ['inAppMarketing', 'member.me.msg.inApp', true],
    ['pushMarketing', 'member.me.msg.push', true],
    ['smsMarketing', 'member.me.msg.sms', prefs.smsAvailable],
    ['whatsappMarketing', 'member.me.msg.whatsapp', prefs.whatsappAvailable],
  ] : [];

  return (
    <>
      <PageTitle eyebrow={t('member.me.eyebrow')} title={t('member.me.title')} />
      <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr))]">
        <form onSubmit={save} className={`${card} flex flex-col gap-4`} data-testid="member-me-profile">
          <h2 className="text-xl font-extrabold">{t('member.me.profile')}</h2>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">{t('member.me.name')}
            <input className={input} value={name} onChange={e => { setName(e.target.value); setSaved(false); }} autoComplete="name" data-testid="member-me-name" /></label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">{t('member.me.phone')}
            <input className={`${input} border-dashed text-[#aab4c4]`} value={me.user.phone ?? ''} readOnly aria-describedby="me-phone-hint" />
            <span id="me-phone-hint" className={`font-normal ${muted}`}>{t('member.me.phoneHint')}</span></label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">{t('member.me.email')}
            <input className={input} type="email" value={email} onChange={e => { setEmail(e.target.value); setSaved(false); }} autoComplete="email" data-testid="member-me-email" /></label>
          {me.user.publicId && <p className="text-sm"><span className={muted}>{t('member.me.memberCode')}: </span><strong className="font-mono tracking-wider">{me.user.publicId}</strong></p>}
          {error && <div role="alert" className="rounded-xl bg-[#3a1d14] px-4 py-3 text-sm text-[#ffd2c4]">{t(errorKey(error))}</div>}
          <div className="flex items-center gap-3">
            <button type="submit" className={primaryBtn} disabled={saving || !name.trim()} data-testid="member-me-save">{t('member.me.save')}</button>
            {saved && <span role="status" className="text-sm text-[#3dd98e]" data-testid="member-me-saved">{t('member.me.saved')}</span>}
          </div>
        </form>

        <div className="flex flex-col gap-4">
          {prefs && (
            <section aria-labelledby="me-msgs" className={`${card} flex flex-col gap-1`} data-testid="member-me-messages">
              <h2 id="me-msgs" className="mb-2 text-xl font-extrabold">{t('member.me.messages')}</h2>
              {prefRows.filter(([, , show]) => show).map(([k, label]) => (
                <label key={k} className="flex items-center justify-between gap-3 border-b border-[#1e293b] py-3">
                  <span>{t(label)}</span>
                  <input type="checkbox" checked={!!prefs[k]} onChange={e => void togglePref(k, e.target.checked)} className="h-5 w-5 accent-[#c8f04a]" data-testid={`member-me-pref-${k}`} />
                </label>
              ))}
              <p className={`mt-2 text-sm ${muted}`}>{t('member.me.messagesHint')}</p>
            </section>
          )}
          <section aria-labelledby="me-lang" className={`${card} flex flex-col gap-3`}>
            <h2 id="me-lang" className="text-xl font-extrabold">{t('member.me.language')}</h2>
            <div role="radiogroup" aria-labelledby="me-lang" className="flex gap-2">
              {(['en', 'sw'] as const).map(l => (
                <button key={l} type="button" role="radio" aria-checked={locale === l} onClick={() => chooseLanguage(l)} data-testid={`member-me-lang-${l}`}
                  className={`min-h-12 flex-1 rounded-xl border text-[15px] ${locale === l ? 'border-[#c8f04a] bg-[#1e293b] font-bold' : 'border-[#334155] text-[#cbd5e1]'}`}>
                  {l === 'en' ? 'English' : 'Kiswahili'}
                </button>
              ))}
            </div>
            <p className={`text-sm ${muted}`}>{t('member.me.languageHint')}</p>
          </section>
          <button type="button" className={`${ghostBtn} self-start`} onClick={signOut} data-testid="member-me-sign-out">{t('member.me.signOut')}</button>
        </div>
      </div>

      <section aria-labelledby="me-del" className="mt-4 flex flex-col gap-3 rounded-3xl border border-[#5c2a1d] bg-[#0f172a] p-6" data-testid="member-me-delete">
        <h2 id="me-del" className="text-xl font-extrabold">{t('member.me.delete')}</h2>
        <p className="max-w-3xl text-sm leading-relaxed text-[#cbd5e1]">{t('member.me.deleteBody')}</p>
        <label className="flex max-w-sm flex-col gap-1.5 text-sm font-semibold">{fmt(t('member.me.deleteType'), { word })}
          <input className={input} value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" data-testid="member-me-delete-type" /></label>
        {deleteError && <div role="alert" className="rounded-xl bg-[#3a1d14] px-4 py-3 text-sm text-[#ffd2c4]" data-testid="member-me-delete-error">{deleteMessage || t(errorKey(deleteError))}</div>}
        <button type="button" disabled={deleting || typed.trim().toUpperCase() !== word} onClick={() => void deleteAccount()} data-testid="member-me-delete-button"
          className="inline-flex min-h-11 items-center self-start rounded-full border border-[#ff8a6b] px-5 text-sm font-bold text-[#ff8a6b] disabled:opacity-50">{t('member.me.deleteButton')}</button>
      </section>
    </>
  );
}
