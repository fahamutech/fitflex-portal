'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useApp } from '../../providers';
import { LoadError, Loading, MemberFrame, PageTitle, card, ghostBtn, input, muted, primaryBtn } from '@/components/member/member-frame';
import { errorKey, PayPanel, type PayTarget } from '@/components/member/pay-panel';
import { fmt, revealPanel } from '@/components/member/member-shared';
import { EVENTS_MODULE } from '@/lib/flags';
import {
  eventsApi, formatDate, formatTzs, MEMBER_ROUTES, MemberApiError, memberApi, newIdempotencyKey,
  type EventDetail, type EventQuote, type EventsOptions, type EventSummary, type EventTicket, type MemberCode, type MemberSession,
  type Participant, type PaymentOptions, type TicketType,
} from '@/lib/member-api';
import type { MessageKey } from '@/lib/i18n';

export default function MemberEventsPage() {
  return <MemberFrame testId="member-events-page">{s => <Events session={s} />}</MemberFrame>;
}

const AVAIL: Record<string, MessageKey> = {
  open: 'member.events.avail.open', closing_soon: 'member.events.avail.closing_soon', sold_out: 'member.events.avail.sold_out',
  closed: 'member.events.avail.closed', not_yet_open: 'member.events.avail.not_yet_open', in_progress: 'member.events.avail.in_progress',
};
const km = (m?: number | null) => (m ? `${Math.round(m / 100) / 10} km` : '');

// Events ship with the events module (decision P3): this build needs NEXT_PUBLIC_EVENTS_MODULE, and the server must
// answer discovery: true on GET /events/options. Either off: one notice, no further request.
function Events({ session }: { session: MemberSession | null }) {
  const { t, locale } = useApp();
  const [opts, setOpts] = useState<EventsOptions | null>(null);
  const [payOpts, setPayOpts] = useState<PaymentOptions | null>(null);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [tickets, setTickets] = useState<EventTicket[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'off'>(EVENTS_MODULE ? 'loading' : 'off');
  const [tab, setTab] = useState<'upcoming' | 'tickets'>('upcoming');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paying, setPaying] = useState<PayTarget | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!EVENTS_MODULE) return;
    if (!silent) setState('loading');
    try {
      const o = await eventsApi.options();
      if (!o.discovery) { setState('off'); return; }
      const [e, tk, p] = await Promise.all([eventsApi.list(), o.registration ? eventsApi.tickets().catch(() => []) : Promise.resolve([]), memberApi.paymentOptions().catch(() => null)]);
      setOpts(o); setEvents(e); setTickets(tk); setPayOpts(p); setState('ready');
    } catch { setState('error'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (state === 'off') return (<><PageTitle eyebrow={t('member.events.eyebrow')} title={t('member.events.title')} /><p className={`${card} ${muted}`} data-testid="member-events-off">{t('member.events.off')}</p></>);
  if (state === 'loading') return <Loading />;
  if (state === 'error' || !opts) return <LoadError onRetry={() => void load()} />;
  if (paying) {
    return (
      <div className="mx-auto max-w-xl">
        <PageTitle title={t('member.events.payTitle')} />
        <PayPanel target={paying} options={payOpts} defaultPhone={session?.user.phone ?? ''} onBack={() => { setPaying(null); void load(true); }} />
      </div>
    );
  }
  const selected = events.find(e => e.id === selectedId) ?? null;
  const tabCls = (on: boolean) => `min-h-11 whitespace-nowrap border-b-[3px] px-4 text-[15px] ${on ? 'border-[#c8f04a] font-bold text-[#f1f5f9]' : 'border-transparent text-[#aab4c4]'}`;

  return (
    <>
      <PageTitle eyebrow={t('member.events.eyebrow')} title={t('member.events.title')} />
      <div role="tablist" aria-label={t('member.events.title')} className="mb-5 flex gap-1 border-b border-[#1e293b]">
        <button type="button" role="tab" aria-selected={tab === 'upcoming'} className={tabCls(tab === 'upcoming')} onClick={() => setTab('upcoming')}>{t('member.events.tab.upcoming')}</button>
        {opts.registration && <button type="button" role="tab" aria-selected={tab === 'tickets'} className={tabCls(tab === 'tickets')} onClick={() => setTab('tickets')} data-testid="member-events-tab-tickets">{fmt(t('member.events.tab.tickets'), { n: tickets.length })}</button>}
      </div>
      {tab === 'tickets' ? <Tickets tickets={tickets} /> : events.length === 0 ? <p className={`${card} ${muted}`}>{t('member.events.empty')}</p> : (
        <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr))]">
          <ul className="flex flex-col gap-3" data-testid="member-events-list">
            {events.map(e => {
              const d = new Date(e.startsAt);
              return (
                <li key={e.id}>
                  <button type="button" onClick={() => { setSelectedId(e.id); revealPanel('member-event-detail'); }} aria-pressed={selected?.id === e.id} data-testid={`member-event-${e.id}`}
                    className={`flex w-full gap-4 rounded-[20px] bg-[#0f172a] p-4 text-left ${selected?.id === e.id ? 'border-2 border-[#c8f04a]' : 'border border-[#1e293b]'}`}>
                    <span className="flex w-16 flex-none flex-col items-center justify-center rounded-xl bg-[#1e293b] py-2">
                      <span className="text-xs uppercase text-[#aab4c4]">{new Intl.DateTimeFormat(locale === 'sw' ? 'sw-TZ' : 'en-GB', { month: 'short', timeZone: 'Africa/Dar_es_Salaam' }).format(d)}</span>
                      <strong className="text-2xl">{new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'Africa/Dar_es_Salaam' }).format(d)}</strong>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <strong className="text-base">{e.title}</strong>
                      <span className="text-sm text-[#cbd5e1]">{[e.venue?.name, e.venue?.city, (e.distancesM ?? []).map(km).join(', ')].filter(Boolean).join(' · ')}</span>
                      <span className={`text-sm ${e.availability === 'sold_out' ? 'text-[#fec84b]' : e.availability === 'open' || e.availability === 'closing_soon' ? 'text-[#3dd98e]' : muted}`}>
                        {t(AVAIL[e.availability] ?? 'member.events.avail.closed')}{e.fromPriceTzs === 0 ? ` · ${t('member.events.free')}` : e.fromPriceTzs ? ` · ${fmt(t('member.events.fromPrice'), { amount: formatTzs(e.fromPriceTzs, locale) })}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {selected ? <EventPanel key={selected.id} id={selected.id} opts={opts} payOpts={payOpts} session={session} onPay={setPaying} onRegistered={() => void load(true)} />
            : <p className={`${card} ${muted}`}>{t('member.events.selectHint')}</p>}
        </div>
      )}
    </>
  );
}

function EventPanel({ id, opts, payOpts, session, onPay, onRegistered }: {
  id: string; opts: EventsOptions; payOpts: PaymentOptions | null; session: MemberSession | null; onPay: (t: PayTarget) => void; onRegistered: () => void;
}) {
  const { t, locale } = useApp();
  const [ev, setEv] = useState<EventDetail | null | 'error'>(null);
  const [ticketId, setTicketId] = useState('');
  const parts = (session?.user.displayName || session?.user.name || '').trim().split(/\s+/);
  const [first, setFirst] = useState(parts[0] ?? '');
  const [last, setLast] = useState(parts.slice(1).join(' '));
  const [phone, setPhone] = useState(session?.user.phone ?? '');
  const [dob, setDob] = useState('');
  const [emName, setEmName] = useState('');
  const [emPhone, setEmPhone] = useState('');
  const [kit, setKit] = useState('');
  const [quote, setQuote] = useState<EventQuote | null>(null);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MemberCode | null>(null);
  const [done, setDone] = useState<'registered' | 'manual' | { waitlist: number | null } | null>(null);
  const [manualOrder, setManualOrder] = useState<{ id: string; total: number } | null>(null);
  const [reference, setReference] = useState('');
  const orderKey = useRef(newIdempotencyKey());

  useEffect(() => {
    let live = true;
    eventsApi.detail(id).then(d => { if (live) setEv(d); }).catch(() => { if (live) setEv('error'); });
    return () => { live = false; };
  }, [id]);

  if (ev === null) return <p role="status" className={`${card} ${muted}`}>{t('member.loading')}</p>;
  if (ev === 'error') return <p role="alert" className={card}>{t('member.error.load')}</p>;

  const all: Array<TicketType & { category: string; distanceM?: number | null }> = ev.categories.flatMap(c => c.ticketTypes.map(tt => ({ ...tt, category: c.name, distanceM: c.distanceM })));
  const chosen = all.find(x => x.id === ticketId) ?? null;
  const soldOut = chosen?.availability === 'sold_out';
  const canWaitlist = soldOut && opts.waitlist && chosen?.waitlist?.state !== 'closed';
  const fields = quote?.fields ?? {};
  const need = (k: string) => fields[k] === 'required';
  const participant = (): Participant => ({
    ticketTypeId: ticketId, firstName: first.trim(), lastName: last.trim(), phone: phone.trim() || undefined, consentBasis: 'self',
    ...(dob ? { dateOfBirth: dob } : {}), ...(emName && emPhone ? { emergencyContact: { name: emName.trim(), phone: emPhone.trim() } } : {}), ...(kit ? { kitSize: kit } : {}),
  });
  const body = () => ({ eventId: ev.id, lines: [{ ticketTypeId: ticketId, quantity: 1 }], participants: [participant()] });
  const total = quote?.quote.totalTzs ?? 0;
  const paymentBlocked = total > 0 && (opts.payment ?? 'none') === 'none';
  const problems = quote?.participants?.[0]?.problems ?? [];

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof MemberApiError ? e.code : 'unknown'); } finally { setBusy(false); }
  }
  const checkPrice = () => run(async () => { setTerms(false); setQuote(await eventsApi.quote(body())); });
  const register = () => run(async () => {
    if (!quote) return;
    const { order } = await eventsApi.place(orderKey.current, { ...body(), acceptedTerms: true, consentTextVersion: quote.consentText?.version ?? opts.consentTextVersion, expectedTotalTzs: quote.quote.totalTzs });
    if (order.totalTzs === 0 || order.status === 'confirmed') { setDone('registered'); onRegistered(); return; }
    if (opts.payment === 'provider') {
      const r = await eventsApi.startPayment(order.id, newIdempotencyKey(), {});
      if (r.next.payment === 'none' || !r.next.paymentRequestId) { setDone('registered'); onRegistered(); return; }
      onPay({ label: `${ev.title} · ${chosen?.name ?? ''}`, amountTzs: order.totalTzs, product: 'EVENT_ORDER', paymentId: r.next.paymentRequestId,
        doneTitleKey: 'member.events.registeredTitle', doneBody: t('member.events.registeredBody'), doneHref: MEMBER_ROUTES.events });
      return;
    }
    setManualOrder({ id: order.id, total: order.totalTzs });
  });
  const sendManual = () => run(async () => {
    if (!manualOrder) return;
    await eventsApi.startPayment(manualOrder.id, newIdempotencyKey(), { reference: reference.trim(), payerPhone: phone.trim() });
    setDone('manual');
  });
  const joinWaitlist = () => run(async () => {
    const r = await eventsApi.joinWaitlist(ev.id, { ticketTypeId: ticketId, participants: [participant()], consent: { accepted: true, textVersion: opts.consentTextVersion } });
    setDone({ waitlist: r.entry.position ?? null });
  });

  const errBox = error && <div role="alert" className="rounded-xl bg-[#3a1d14] px-4 py-3 text-sm text-[#ffd2c4]" data-testid="member-event-error">{t(errorKey(error))}</div>;
  const field = (label: MessageKey, value: string, set: (v: string) => void, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="flex flex-col gap-1.5 text-sm font-semibold">{t(label)}<input className={input} value={value} onChange={e => { set(e.target.value); setQuote(null); }} {...extra} /></label>
  );

  return (
    <section aria-labelledby="ev-h" className={`${card} flex flex-col gap-4 lg:sticky lg:top-4`} data-testid="member-event-detail">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {ev.heroImageUrl && <img src={ev.heroImageUrl} alt="" className="h-36 w-full rounded-2xl object-cover" />}
      <div className="flex flex-col gap-1">
        <h2 id="ev-h" className="text-2xl font-extrabold">{ev.title}</h2>
        <span className={`text-sm ${muted}`}>{formatDate(ev.startsAt, locale, true)} · {[ev.venue?.name, ev.venue?.city].filter(Boolean).join(', ')}</span>
        {ev.organizer?.name && <span className={`text-sm ${muted}`}>{fmt(t('member.events.organizer'), { name: ev.organizer.name })}</span>}
      </div>
      {(locale === 'sw' ? ev.description?.sw || ev.description?.en : ev.description?.en || ev.description?.sw) && (
        <p className="whitespace-pre-line text-sm text-[#cbd5e1]">{locale === 'sw' ? ev.description?.sw || ev.description?.en : ev.description?.en || ev.description?.sw}</p>
      )}

      {done ? (
        <div className="flex flex-col gap-2 rounded-2xl border-2 border-[#3dd98e] p-4" data-testid="member-event-done" role="status">
          <strong className="text-lg">{done === 'registered' ? t('member.events.registeredTitle') : done === 'manual' ? t('member.pay.manualDoneTitle') : fmt(t('member.events.waitlistJoined'), { n: done.waitlist ?? '—' })}</strong>
          <span className={`text-sm ${muted}`}>{done === 'registered' ? t('member.events.registeredBody') : done === 'manual' ? t('member.pay.manualDoneBody') : t('member.events.waitlistBody')}</span>
        </div>
      ) : !opts.registration ? null : manualOrder ? (
        <div className="flex flex-col gap-4" data-testid="member-event-manual">
          <h3 className="text-lg font-extrabold">{t('member.pay.manualTitle')}</h3>
          <p className={`text-sm ${muted}`}>{fmt(t('member.pay.manualBody'), { amount: formatTzs(manualOrder.total, locale) })}</p>
          {payOpts?.manual?.lipaNamba && (
            <dl className="grid gap-3 rounded-2xl border border-[#1e293b] bg-[#020617] p-4 sm:grid-cols-2">
              <div><dt className={`text-sm ${muted}`}>{t('member.pay.manualNumber')}</dt><dd className="font-mono text-xl font-bold">{payOpts.manual.lipaNamba}</dd></div>
              <div><dt className={`text-sm ${muted}`}>{t('member.pay.manualName')}</dt><dd className="font-bold">{payOpts.manual.accountName}</dd></div>
            </dl>
          )}
          {errBox}
          <label className="flex flex-col gap-1.5 text-sm font-semibold">{t('member.pay.manualRef')}
            <input className={`${input} font-mono uppercase`} value={reference} onChange={e => setReference(e.target.value)} data-testid="member-event-reference" /></label>
          <button type="button" className={`${primaryBtn} self-start`} disabled={busy || !reference.trim()} onClick={() => void sendManual()}>{t('member.pay.manualSubmit')}</button>
        </div>
      ) : (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-semibold">{t('member.events.choose')}</legend>
            {all.map(x => (
              <label key={x.id} className={`flex cursor-pointer items-center justify-between gap-3 rounded-2xl px-4 py-3 ${ticketId === x.id ? 'border-2 border-[#c8f04a]' : 'border border-[#334155]'}`}>
                <span className="flex items-center gap-3">
                  <input type="radio" name="ev-ticket" checked={ticketId === x.id} onChange={() => { setTicketId(x.id); setQuote(null); setError(null); }} className="h-5 w-5 accent-[#c8f04a]" data-testid={`member-event-ticket-${x.id}`} />
                  <span className="flex flex-col"><strong>{x.category}{x.name && x.name !== x.category ? ` · ${x.name}` : ''}</strong><span className={`text-sm ${muted}`}>{km(x.distanceM)}</span></span>
                </span>
                <span className="flex flex-col items-end text-sm tabular-nums">
                  <strong>{x.priceTzs === 0 ? t('member.events.free') : formatTzs(x.priceTzs, locale)}</strong>
                  {x.availability === 'sold_out' && <span className="text-[#fec84b]">{t('member.events.soldOut')}</span>}
                </span>
              </label>
            ))}
          </fieldset>
          {chosen && (soldOut && !canWaitlist ? null : (
            <div className="flex flex-col gap-3">
              <h3 className="text-base font-extrabold">{t('member.events.yourDetails')}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {field('member.events.firstName', first, setFirst, { autoComplete: 'given-name', 'data-testid': 'member-event-first' } as React.InputHTMLAttributes<HTMLInputElement>)}
                {field('member.events.lastName', last, setLast, { autoComplete: 'family-name', 'data-testid': 'member-event-last' } as React.InputHTMLAttributes<HTMLInputElement>)}
              </div>
              {field('member.events.phone', phone, setPhone, { type: 'tel', autoComplete: 'tel' })}
              {need('dateOfBirth') && field('member.events.dob', dob, setDob, { type: 'date', 'data-testid': 'member-event-dob' } as React.InputHTMLAttributes<HTMLInputElement>)}
              {need('emergencyContact') && (
                <div className="grid gap-3 sm:grid-cols-2">{field('member.events.emergencyName', emName, setEmName)}{field('member.events.emergencyPhone', emPhone, setEmPhone, { type: 'tel' })}</div>
              )}
              {need('kitSize') && field('member.events.kitSize', kit, setKit)}
              <p className={`text-sm ${muted}`}>{t('member.events.selfOnly')}</p>
            </div>
          ))}
          {problems.length > 0 && <ul role="alert" className="flex flex-col gap-1 text-sm text-[#ffd2c4]">{problems.map(p => <li key={`${p.field}-${p.code}`}>{fmt(t('member.events.problem'), { field: p.field })}</li>)}</ul>}
          {errBox}
          {chosen && canWaitlist && (
            <div className="flex flex-col gap-2">
              <p className={`text-sm ${muted}`}>{t('member.events.waitlistBody')}</p>
              <button type="button" className={`${ghostBtn} self-start`} disabled={busy || !first.trim() || !last.trim()} onClick={() => void joinWaitlist()} data-testid="member-event-waitlist">{t('member.events.waitlist')}</button>
            </div>
          )}
          {chosen && !soldOut && !quote && (
            <button type="button" className={`${ghostBtn} self-start`} disabled={busy || !first.trim() || !last.trim()} onClick={() => void checkPrice()} data-testid="member-event-quote">{t('member.events.checkPrice')}</button>
          )}
          {quote && (
            <div className="flex flex-col gap-3" data-testid="member-event-quote-result">
              <div className="flex items-center justify-between rounded-2xl border border-[#1e293b] bg-[#020617] px-4 py-3.5">
                <span className="flex flex-col"><strong>{t('member.events.total')}</strong>{quote.quote.feesTzs > 0 && <span className={`text-sm ${muted}`}>{fmt(t('member.events.fees'), { amount: formatTzs(quote.quote.feesTzs, locale) })}</span>}</span>
                <strong className="text-xl tabular-nums">{total === 0 ? t('member.events.free') : formatTzs(total, locale)}</strong>
              </div>
              {quote.consentText?.self && <p className={`text-sm ${muted}`}>{quote.consentText.self}</p>}
              <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={terms} onChange={e => setTerms(e.target.checked)} className="mt-0.5 h-5 w-5 flex-none accent-[#c8f04a]" data-testid="member-event-terms" />{t('member.events.terms')}</label>
              {paymentBlocked
                ? <p className="rounded-xl bg-[#3a1d14] px-4 py-3 text-sm text-[#ffd2c4]" data-testid="member-event-pay-not-open">{t('member.events.payNotOpen')}</p>
                : <button type="button" className={primaryBtn} disabled={busy || !terms || !quote.valid} onClick={() => void register()} data-testid="member-event-register">
                    {busy ? t('member.events.registering') : total > 0 ? fmt(t('member.events.registerPay'), { amount: formatTzs(total, locale) }) : t('member.events.register')}
                  </button>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Tickets({ tickets }: { tickets: EventTicket[] }) {
  const { t, locale } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const [qr, setQr] = useState<{ svg: string; code: string } | null | 'error' | 'revoked'>(null);
  const show = async (id: string) => {
    setOpen(id); setQr(null);
    try {
      const r = await eventsApi.ticket(id);
      setQr({ svg: await QRCode.toString(r.qrPayload, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }), code: r.ticket.displayCode });
    } catch (e) { setQr(e instanceof MemberApiError && e.status === 409 ? 'revoked' : 'error'); }
  };
  if (tickets.length === 0) return <p className={`${card} ${muted}`}>{t('member.events.noTickets')}</p>;
  return (
    <ul className="flex flex-col gap-4" data-testid="member-event-tickets">
      {tickets.map(k => (
        <li key={k.registrationId} className={`${card} grid items-center gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))] ${k.state === 'active' ? 'border-2 border-[#3dd98e]' : ''}`}>
          <div className="flex flex-col gap-2">
            <strong className="text-lg">{k.event.title}</strong>
            <span className={`text-sm ${muted}`}>{formatDate(k.event.startsAt, locale, true)}{k.category?.name ? ` · ${k.category.name}` : ''}</span>
            {k.displayCode && <span className="font-mono text-sm">{fmt(t('member.events.ticketCode'), { code: k.displayCode })}</span>}
            {k.state === 'active'
              ? <button type="button" className={`${ghostBtn} self-start`} onClick={() => void show(k.registrationId)} data-testid={`member-event-show-${k.registrationId}`}>{t('member.events.showTicket')}</button>
              : <span className="text-sm text-[#fec84b]">{t('member.events.ticketRevoked')}</span>}
          </div>
          {open === k.registrationId && (
            qr === null ? <p role="status" className={muted}>{t('member.loading')}</p>
              : qr === 'revoked' ? <p className="text-[#fec84b]">{t('member.events.ticketRevoked')}</p>
              : qr === 'error' ? <p role="alert">{t('member.error.load')}</p>
              : (
                <div className="flex flex-col items-center gap-2 rounded-2xl bg-[#f7f5f0] p-4 text-[#101828]" data-testid="member-event-qr">
                  <div role="img" aria-label={t('member.events.ticketAlt')} className="w-full max-w-[200px] bg-white p-1.5 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qr.svg }} />
                  <span className="font-mono font-bold tracking-wider">{qr.code}</span>
                </div>
              )
          )}
        </li>
      ))}
    </ul>
  );
}
