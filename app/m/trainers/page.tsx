'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../providers';
import { LoadError, Loading, MemberFrame, PageTitle, card, input, linkCls, muted, primaryBtn } from '@/components/member/member-frame';
import { errorKey, PayPanel, type PayTarget } from '@/components/member/pay-panel';
import { fmt, revealPanel } from '@/components/member/member-shared';
import {
  canPayByMobileMoney, eatToday, formatDate, formatTzs, MEMBER_ROUTES, MemberApiError, memberApi,
  type BookingQuote, type MemberCode, type MemberSession, type PaymentOptions, type ScheduleDay, type Trainer, type TrainerBooking,
} from '@/lib/member-api';
import type { MessageKey } from '@/lib/i18n';

export default function MemberTrainersPage() {
  return <MemberFrame testId="member-trainers-page">{s => <Trainers session={s} />}</MemberFrame>;
}

const STATUS_KEYS: Record<string, MessageKey> = {
  payment_pending: 'member.trainers.status.payment_pending', confirmed: 'member.trainers.status.confirmed',
  completed: 'member.trainers.status.completed', cancelled: 'member.trainers.status.cancelled',
};

function Trainers({ session }: { session: MemberSession | null }) {
  const { t, locale } = useApp();
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [bookings, setBookings] = useState<TrainerBooking[]>([]);
  const [options, setOptions] = useState<PaymentOptions | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [specialty, setSpecialty] = useState<string | null>(null);
  const [gymFilter, setGymFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paying, setPaying] = useState<PayTarget | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setState('loading');
    try {
      const [tr, bk, op] = await Promise.all([memberApi.trainers(), memberApi.myBookings().catch(() => []), memberApi.paymentOptions().catch(() => null)]);
      setTrainers(tr.filter(x => x.bookable !== false)); setBookings(bk); setOptions(op); setState('ready');
    } catch { setState('error'); }
  }, []);
  useEffect(() => {
    // ?gym= from a gym's "Trainers here" link (read once; no search-params hook, so the page stays static).
    const g = new URLSearchParams(window.location.search).get('gym');
    if (g) setGymFilter(g);
    void load();
  }, [load]);

  const specialties = useMemo(() => [...new Set(trainers.flatMap(x => x.specialties ?? []))].slice(0, 8), [trainers]);
  const shown = trainers.filter(x => (!specialty || x.specialties?.includes(specialty)) && (!gymFilter || x.gymIds?.includes(gymFilter) || x.gyms?.some(g => g.id === gymFilter)));
  const gymName = gymFilter ? trainers.flatMap(x => x.gyms ?? []).find(g => g.id === gymFilter)?.name : null;

  if (state === 'loading') return <Loading />;
  if (state === 'error') return <LoadError onRetry={() => void load()} />;
  if (paying) {
    return (
      <div className="mx-auto max-w-xl">
        <PageTitle title={t('member.trainers.title')} />
        <PayPanel target={paying} options={options} defaultPhone={session?.user.phone ?? ''} onBack={() => { setPaying(null); void load(true); }} />
      </div>
    );
  }
  const selected = shown.find(x => x.id === selectedId) ?? null;
  const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm ${on ? 'border-[#c8f04a] bg-[#1e293b] font-semibold' : 'border-[#334155] text-[#cbd5e1]'}`;
  const upcoming = bookings.filter(b => b.status !== 'cancelled' && b.date >= eatToday()).slice(0, 6);

  return (
    <>
      <PageTitle eyebrow={t('member.trainers.eyebrow')} title={t('member.trainers.title')} />
      <div className="mb-6 flex flex-wrap gap-2.5" role="group" aria-label={t('member.trainers.title')}>
        <button type="button" aria-pressed={!specialty && !gymFilter} className={chip(!specialty && !gymFilter)} onClick={() => { setSpecialty(null); setGymFilter(null); }}>{t('member.trainers.all')}</button>
        {gymFilter && <button type="button" aria-pressed="true" className={chip(true)} onClick={() => setGymFilter(null)}>{fmt(t('member.trainers.at'), { gym: gymName ?? '…' })} ×</button>}
        {specialties.map(s => <button key={s} type="button" aria-pressed={specialty === s} className={chip(specialty === s)} onClick={() => setSpecialty(specialty === s ? null : s)}>{s}</button>)}
      </div>
      <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr))]">
        <div className="flex flex-col gap-4">
          {shown.length === 0 ? <p className={`${card} ${muted}`}>{t('member.trainers.empty')}</p> : (
            <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr))]" data-testid="member-trainers-list">
              {shown.map(x => (
                <li key={x.id}>
                  <button type="button" onClick={() => { setSelectedId(x.id); revealPanel('member-trainer-booking'); }} aria-pressed={selected?.id === x.id} data-testid={`member-trainer-${x.id}`}
                    className={`flex h-full w-full flex-col gap-2.5 rounded-[20px] bg-[#0f172a] p-4 text-left ${selected?.id === x.id ? 'border-2 border-[#c8f04a]' : 'border border-[#1e293b]'}`}>
                    <span className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {x.photoUrl ? <img src={x.photoUrl} alt="" className="h-14 w-14 flex-none rounded-full object-cover" /> : <span aria-hidden="true" className="h-14 w-14 flex-none rounded-full bg-[#1e293b]" />}
                      <span className="flex flex-col"><strong>{x.displayName}</strong>
                        <span className={`text-sm ${muted}`}>{[(x.specialties ?? []).slice(0, 2).join(', '), x.experienceYears ? fmt(t('member.trainers.years'), { n: x.experienceYears }) : null].filter(Boolean).join(' · ')}</span>
                      </span>
                    </span>
                    {x.gyms?.length ? <span className="text-sm text-[#cbd5e1]">{x.gyms.map(g => g.name).join(', ')}</span> : null}
                    <span className="mt-auto flex justify-between text-sm">
                      <span>{x.rating ? `★ ${x.rating.toFixed(1)} (${x.reviewCount ?? 0})` : ''}</span>
                      {x.hourlyRateTzs ? <strong className="tabular-nums">{fmt(t('member.trainers.from'), { amount: formatTzs(x.hourlyRateTzs, locale) })}</strong> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {selected
          ? <BookingPanel key={selected.id} trainer={selected} options={options} preferredGym={gymFilter} onPay={setPaying} onBooked={() => void load(true)} />
          : <p className={`${card} ${muted}`}>{t('member.trainers.selectHint')}</p>}
      </div>
      <div className="mt-4">
        <section aria-labelledby="my-sessions" className={card}>
            <h2 id="my-sessions" className="mb-2 text-lg font-extrabold">{t('member.trainers.mySessions')}</h2>
            {upcoming.length === 0 ? <p className={muted}>{t('member.trainers.noSessions')}</p> : (
              <ul className="divide-y divide-[#1e293b]" data-testid="member-trainer-sessions">
                {upcoming.map(b => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span className="flex flex-col"><strong>{b.trainer?.displayName ?? '—'}</strong><span className={`text-sm ${muted}`}>{formatDate(`${b.date}T12:00:00+03:00`, locale)} · {b.slot}{b.gym?.name ? ` · ${b.gym.name}` : ''}</span></span>
                    <span className="rounded-full bg-[#1e293b] px-2.5 py-0.5 text-xs font-bold">{t(STATUS_KEYS[b.status] ?? 'member.trainers.status.other')}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
      </div>
    </>
  );
}

function BookingPanel({ trainer, options, preferredGym, onPay, onBooked }: {
  trainer: Trainer; options: PaymentOptions | null; preferredGym: string | null; onPay: (t: PayTarget) => void; onBooked: () => void;
}) {
  const { t, locale } = useApp();
  const gyms = trainer.gyms?.length ? trainer.gyms : (trainer.gymIds ?? []).map(id => ({ id, name: id }));
  const [gymId, setGymId] = useState(preferredGym && gyms.some(g => g.id === preferredGym) ? preferredGym : gyms[0]?.id ?? '');
  const [days, setDays] = useState<ScheduleDay[] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [quote, setQuote] = useState<BookingQuote['summary'] | null>(null);
  const [error, setError] = useState<MemberCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [booked, setBooked] = useState<string | null>(null);
  const payable = canPayByMobileMoney(options, 'TRAINER_SERVICE');

  useEffect(() => {
    if (!gymId) return;
    let live = true;
    setDays(null); setSlot(null); setQuote(null);
    memberApi.trainerSchedule(trainer.id, gymId, eatToday(), 7)
      .then(d => { if (!live) return; setDays(d); setDate(d.find(x => x.slots.some(s => s.status === 'available'))?.date ?? d[0]?.date ?? null); })
      .catch(() => { if (live) setDays([]); });
    return () => { live = false; };
  }, [trainer.id, gymId]);

  useEffect(() => {
    if (!date || !slot) { setQuote(null); return; }
    let live = true;
    setError(null);
    memberApi.quoteBooking({ trainerId: trainer.id, gymId, slots: [{ date, slot }] })
      .then(q => { if (live) setQuote(q.summary); })
      .catch(e => { if (live) { setQuote(null); setError(e instanceof MemberApiError ? e.code : 'unknown'); } });
    return () => { live = false; };
  }, [trainer.id, gymId, date, slot]);

  const day = days?.find(d => d.date === date) ?? null;
  const body = date && slot ? { trainerId: trainer.id, gymId, slots: [{ date, slot }] } : null;
  const when = date && slot ? `${formatDate(`${date}T12:00:00+03:00`, locale)} · ${slot}` : '';

  async function book() {
    if (!body || !quote) { setError(null); return; }
    if (quote.total > 0) {
      onPay({
        label: `${trainer.displayName} · ${when}`, amountTzs: quote.total, product: 'TRAINER_SERVICE',
        create: async () => {
          const r = await memberApi.book(body);
          if (!r.paymentRequest) throw new MemberApiError(409, 'payment_not_pending');
          return r.paymentRequest.id;
        },
        doneTitleKey: 'member.trainers.bookedTitle',
        doneBody: fmt(t('member.trainers.bookedBody'), { trainer: trainer.displayName, date: formatDate(`${date}T12:00:00+03:00`, locale), slot: slot ?? '' }),
        doneHref: MEMBER_ROUTES.trainers,
      });
      return;
    }
    setBusy(true); setError(null);
    try { await memberApi.book(body); setBooked(when); onBooked(); }
    catch (e) { setError(e instanceof MemberApiError ? e.code : 'unknown'); }
    finally { setBusy(false); }
  }

  if (booked) {
    return (
      <section className={`${card} flex flex-col gap-3`} data-testid="member-trainer-booked">
        <h2 className="text-2xl font-extrabold">{t('member.trainers.bookedTitle')}</h2>
        <p>{trainer.displayName} · {booked}</p>
        <button type="button" className={`${linkCls} self-start`} onClick={() => setBooked(null)}>{t('member.trainers.backToTrainers')}</button>
      </section>
    );
  }

  return (
    <section aria-labelledby="book-h" className={`${card} flex flex-col gap-5 lg:sticky lg:top-4`} data-testid="member-trainer-booking">
      <div className="flex flex-col gap-1">
        <h2 id="book-h" className="text-2xl font-extrabold">{fmt(t('member.trainers.book'), { name: trainer.displayName })}</h2>
        {trainer.bio && <p className={`text-sm ${muted}`}>{trainer.bio}</p>}
      </div>
      {gyms.length > 1 && (
        <label className="flex flex-col gap-1.5 text-sm font-semibold">{t('member.trainers.gym')}
          <select className={input} value={gymId} onChange={e => setGymId(e.target.value)} data-testid="member-trainer-gym">
            {gyms.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
      )}
      {days === null ? <p role="status" className={muted}>{t('member.loading')}</p> : (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-semibold">{t('member.trainers.day')}</legend>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {days.map(d => (
                <button key={d.date} type="button" aria-pressed={d.date === date} onClick={() => { setDate(d.date); setSlot(null); }}
                  className={`min-h-14 min-w-16 flex-none rounded-xl border px-3 text-sm ${d.date === date ? 'border-2 border-[#c8f04a] bg-[#1e293b] font-bold' : 'border-[#334155]'}`}>
                  {new Intl.DateTimeFormat(locale === 'sw' ? 'sw-TZ' : 'en-GB', { weekday: 'short', day: 'numeric', timeZone: 'Africa/Dar_es_Salaam' }).format(new Date(`${d.date}T12:00:00+03:00`))}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-semibold">{t('member.trainers.time')}</legend>
            {!day || day.slots.filter(s => s.status !== 'past').length === 0 ? <p className={muted}>{t('member.trainers.noSlots')}</p> : (
              <div className="flex flex-wrap gap-2">
                {day.slots.filter(s => s.status !== 'past').map(s => s.status === 'available' ? (
                  <button key={s.slot} type="button" aria-pressed={slot === s.slot} onClick={() => setSlot(s.slot)} data-testid={`member-slot-${s.slot}`}
                    className={`min-h-11 rounded-xl px-3.5 text-sm tabular-nums ${slot === s.slot ? 'bg-[#c8f04a] font-extrabold text-[#020617]' : 'border border-[#334155]'}`}>{s.slot}</button>
                ) : (
                  <span key={s.slot} aria-label={fmt(t('member.trainers.slotTaken'), { slot: s.slot })}
                    className="inline-flex min-h-11 items-center rounded-xl border border-dashed border-[#334155] px-3.5 text-sm text-[#64748b] line-through">{s.slot}</span>
                ))}
              </div>
            )}
          </fieldset>
        </>
      )}
      {error && <div role="alert" className="rounded-xl bg-[#3a1d14] px-4 py-3 text-sm text-[#ffd2c4]" data-testid="member-trainer-error">{t(errorKey(error))}</div>}
      {quote && (
        <div className="flex flex-col gap-1 rounded-2xl border border-[#1e293b] bg-[#020617] px-4 py-3.5" data-testid="member-trainer-quote">
          <div className="flex items-center justify-between gap-3"><strong>{when}</strong><strong className="whitespace-nowrap text-xl tabular-nums">{formatTzs(quote.total, locale)}</strong></div>
          {quote.discount > 0 && <span className={`text-sm ${muted}`}>{fmt(t('member.trainers.discount'), { pct: quote.discountPct, amount: formatTzs(quote.discount, locale) })}</span>}
          <span className={`text-sm ${muted}`}>{t('member.trainers.passEntry')}</span>
        </div>
      )}
      {quote && quote.total > 0 && !payable
        ? <p className="rounded-xl bg-[#3a1d14] px-4 py-3 text-sm text-[#ffd2c4]" data-testid="member-trainer-in-app">{t('member.trainers.inApp')}</p>
        : (
          <button type="button" className={primaryBtn} disabled={!quote || busy} onClick={() => void book()} data-testid="member-trainer-book">
            {quote && quote.total > 0 ? fmt(t('member.trainers.bookPay'), { amount: formatTzs(quote.total, locale) }) : t('member.trainers.bookFree')}
          </button>
        )}
      {!slot && <p className={`text-sm ${muted}`}>{t('member.trainers.chooseSlot')}</p>}
    </section>
  );
}
