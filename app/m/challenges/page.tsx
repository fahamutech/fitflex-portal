'use client';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../providers';
import { LoadError, Loading, MemberFrame, PageTitle, card, ghostBtn, input, muted, primaryBtn } from '@/components/member/member-frame';
import { errorKey } from '@/components/member/pay-panel';
import { fmt, revealPanel } from '@/components/member/member-shared';
import { formatDate, MemberApiError, memberApi3, type Challenge, type Leaderboard, type MemberCode } from '@/lib/member-api';
import type { MessageKey } from '@/lib/i18n';

export default function MemberChallengesPage() {
  return <MemberFrame testId="member-challenges-page">{() => <Challenges />}</MemberFrame>;
}

type Tab = 'joined' | 'open' | 'ended';
const day = (d: string) => `${d}T12:00:00+03:00`;
const goalKey = (type: string) => `member.challenges.type.${type}` as MessageKey;

function phaseLabel(c: Challenge, t: (k: MessageKey) => string, locale: 'en' | 'sw') {
  if (c.phase === 'upcoming') return fmt(t('member.challenges.phase.upcoming'), { date: formatDate(day(c.startDate), locale) });
  if (c.phase === 'active') return t('member.challenges.phase.active');
  if (c.phase === 'cancelled') return t('member.challenges.phase.cancelled');
  return t('member.challenges.phase.ended');
}

function Challenges() {
  const { t, locale } = useApp();
  const [list, setList] = useState<Challenge[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tab, setTab] = useState<Tab>('joined');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async (keepTab = false) => {
    if (!keepTab) setState('loading');
    try {
      const c = await memberApi3.challenges();
      setList(c);
      if (!keepTab) setTab(c.some(x => x.joined && x.phase !== 'ended') ? 'joined' : 'open');
      setState('ready');
    } catch { setState('error'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (state === 'loading') return <Loading />;
  if (state === 'error') return <LoadError onRetry={() => void load()} />;

  const groups: Record<Tab, Challenge[]> = {
    joined: list.filter(c => c.joined && c.phase !== 'ended' && c.phase !== 'cancelled'),
    open: list.filter(c => !c.joined && (c.phase === 'active' || c.phase === 'upcoming')),
    ended: list.filter(c => c.joined && (c.phase === 'ended' || c.phase === 'cancelled')),
  };
  const shown = groups[tab];
  const selected = shown.find(c => c.id === selectedId) ?? shown[0] ?? null;
  const tabCls = (on: boolean) => `min-h-11 whitespace-nowrap border-b-[3px] px-4 text-[15px] ${on ? 'border-[#c8f04a] font-bold text-[#f1f5f9]' : 'border-transparent text-[#aab4c4]'}`;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle eyebrow={t('member.challenges.eyebrow')} title={t('member.challenges.title')} />
        <p className={`mb-6 text-sm ${muted}`}>{t('member.challenges.intro')}</p>
      </div>
      <div role="tablist" aria-label={t('member.challenges.title')} className="mb-5 flex gap-1 overflow-x-auto border-b border-[#1e293b]">
        {(['joined', 'open', 'ended'] as Tab[]).map(k => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tabCls(tab === k)} onClick={() => { setTab(k); setSelectedId(null); }} data-testid={`member-challenges-tab-${k}`}>
            {fmt(t(`member.challenges.tab.${k}` as MessageKey), { n: groups[k].length })}
          </button>
        ))}
      </div>
      {shown.length === 0 ? <p className={`${card} ${muted}`}>{t('member.challenges.empty')}</p> : (
        <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr))]">
          <ul className="flex flex-col gap-3" data-testid="member-challenges-list">
            {shown.map(c => (
              <li key={c.id}>
                <button type="button" onClick={() => { setSelectedId(c.id); revealPanel('member-challenge-detail'); }} aria-pressed={selected?.id === c.id} data-testid={`member-challenge-${c.id}`}
                  className={`flex w-full flex-col gap-2 rounded-[20px] bg-[#0f172a] p-4 text-left ${selected?.id === c.id ? 'border-2 border-[#c8f04a]' : 'border border-[#1e293b]'}`}>
                  <span className="flex items-start justify-between gap-3">
                    <strong className="text-lg">{c.name}</strong>
                    <span className={`flex-none rounded-full px-2.5 py-0.5 text-xs font-bold ${c.phase === 'active' ? 'bg-[#134e48] text-[#ccfbef]' : 'bg-[#1e293b] text-[#c8f04a]'}`}>{phaseLabel(c, t, locale)}</span>
                  </span>
                  <span className="text-sm text-[#cbd5e1]">{fmt(t(goalKey(c.type)), { n: c.target })} · {fmt(t('member.challenges.dates'), { from: formatDate(day(c.startDate), locale), to: formatDate(day(c.endDate), locale) })}</span>
                  <span className={`text-sm ${muted}`}>{fmt(t('member.challenges.members'), { n: c.participantCount })}</span>
                </button>
              </li>
            ))}
          </ul>
          {selected && <ChallengeDetail key={selected.id} c={selected} onChanged={() => void load(true)} />}
        </div>
      )}
    </>
  );
}

function ChallengeDetail({ c, onChanged }: { c: Challenge; onChanged: () => void }) {
  const { t, locale } = useApp();
  const [teamId, setTeamId] = useState('');
  const [optIn, setOptIn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MemberCode | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const needsTeam = c.mode !== 'individual' && c.mode !== 'department' && c.teams.length > 0;

  useEffect(() => {
    if (!c.joined) { setBoard(null); return; }
    let live = true;
    memberApi3.leaderboard(c.id).then(b => { if (live) setBoard(b); }).catch(() => { if (live) setBoard(null); });
    return () => { live = false; };
  }, [c.id, c.joined]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); setConfirmLeave(false); onChanged(); }
    catch (e) { setError(e instanceof MemberApiError ? e.code : 'unknown'); }
    finally { setBusy(false); }
  }
  const join = () => {
    if (needsTeam && !teamId) { setError(c.mode === 'gym_vs_gym' ? 'gym_required' : 'team_required'); return; }
    const team = c.teams.find(x => x.id === teamId);
    void act(() => memberApi3.joinChallenge(c.id, {
      leaderboardOptIn: optIn,
      ...(needsTeam ? (c.mode === 'gym_vs_gym' ? { gymId: team?.gymId ?? undefined, teamId } : { teamId }) : {}),
    }));
  };
  const canJoin = !c.joined && (c.phase === 'active' || c.phase === 'upcoming');

  return (
    <section aria-labelledby="ch-detail" className={`${card} flex flex-col gap-4 lg:sticky lg:top-4`} data-testid="member-challenge-detail">
      <div className="flex flex-col gap-1">
        <h2 id="ch-detail" className="text-2xl font-extrabold">{c.name}</h2>
        <span className={`text-sm ${muted}`}>{c.creator?.name ? fmt(t('member.challenges.by'), { name: c.creator.name }) : t('member.challenges.byFitflex')} · {fmt(t('member.challenges.dates'), { from: formatDate(day(c.startDate), locale), to: formatDate(day(c.endDate), locale) })}</span>
      </div>
      {c.description && <p className="text-[#cbd5e1]">{c.description}</p>}
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-[#94a3b8]">{t('member.challenges.goal')}</dt><dd className="font-semibold">{fmt(t(goalKey(c.type)), { n: c.target })}</dd></div>
        <div><dt className="text-[#94a3b8]">{phaseLabel(c, t, locale)}</dt><dd className="font-semibold">{fmt(t('member.challenges.members'), { n: c.participantCount })}</dd></div>
      </dl>
      {error && <div role="alert" className="rounded-xl bg-[#3a1d14] px-4 py-3 text-sm text-[#ffd2c4]" data-testid="member-challenge-error">{t(errorKey(error))}</div>}
      {canJoin && (
        <div className="flex flex-col gap-3">
          {needsTeam && (
            <label className="flex flex-col gap-1.5 text-sm font-semibold">{t('member.challenges.team')}
              <select className={input} value={teamId} onChange={e => setTeamId(e.target.value)} data-testid="member-challenge-team">
                <option value="">{t('member.challenges.chooseTeam')}</option>
                {c.teams.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
          )}
          <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={optIn} onChange={e => setOptIn(e.target.checked)} className="h-5 w-5 accent-[#c8f04a]" data-testid="member-challenge-optin" />{t('member.challenges.showMe')}</label>
          <button type="button" className={`${primaryBtn} self-start`} disabled={busy} onClick={join} data-testid="member-challenge-join">{t('member.challenges.join')}</button>
        </div>
      )}
      {c.joined && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-[#134e48] px-3 py-1 text-sm font-bold text-[#ccfbef]">{t('member.challenges.joined')} ✓</span>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.leaderboardOptIn} disabled={busy}
              onChange={e => void act(() => memberApi3.setLeaderboardOptIn(c.id, e.target.checked))} className="h-5 w-5 accent-[#c8f04a]" data-testid="member-challenge-optin-joined" />{t('member.challenges.showMe')}</label>
          </div>
          <LeaderboardView board={board} />
          {c.phase !== 'ended' && c.phase !== 'cancelled' && (confirmLeave ? (
            <div role="alertdialog" aria-labelledby="leave-q" className="flex flex-col gap-3 rounded-2xl border border-[#5c2a1d] p-4">
              <p id="leave-q">{t('member.challenges.leaveConfirm')}</p>
              <div className="flex flex-wrap gap-2.5">
                <button type="button" disabled={busy} onClick={() => void act(() => memberApi3.leaveChallenge(c.id))} data-testid="member-challenge-leave-yes"
                  className="inline-flex min-h-11 items-center rounded-full border border-[#ff8a6b] px-5 text-sm font-bold text-[#ff8a6b]">{t('member.challenges.leaveYes')}</button>
                <button type="button" className={ghostBtn} onClick={() => setConfirmLeave(false)}>{t('member.activity.deleteNo')}</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmLeave(true)} className="self-start text-sm font-semibold text-[#ff8a6b] underline-offset-4 hover:underline" data-testid="member-challenge-leave">{t('member.challenges.leave')}</button>
          ))}
        </>
      )}
    </section>
  );
}

function LeaderboardView({ board }: { board: Leaderboard | null }) {
  const { t } = useApp();
  if (!board) return <p role="status" className={muted}>{t('member.loading')}</p>;
  const you = board.you;
  return (
    <div className="flex flex-col gap-2" data-testid="member-challenge-leaderboard">
      <h3 className="text-lg font-extrabold">{t('member.challenges.leaderboard')}</h3>
      {you && <p className="text-sm text-[#cbd5e1]">{fmt(t(you.optedIn ? 'member.challenges.youRank' : 'member.challenges.youHidden'), { rank: you.rank, of: you.of })}</p>}
      {board.individuals.length === 0 ? <p className={`text-sm ${muted}`}>{t('member.challenges.noRanking')}</p> : (
        <ol className="flex flex-col tabular-nums">
          {board.individuals.slice(0, 10).map(r => (
            <li key={`${r.rank}-${r.name}`} aria-current={r.you ? 'true' : undefined}
              className={`flex items-center gap-3.5 px-3 py-2.5 ${r.you ? 'rounded-xl bg-[#1e293b] font-bold' : 'border-b border-[#1e293b]'}`}>
              <span className="w-7 font-extrabold text-[#c8f04a]">{r.rank}</span>
              <span className="flex-1">{r.you ? t('member.challenges.you') : r.name}</span>
              <span>{Math.round(Math.min(1, r.fraction) * 100)}%</span>
            </li>
          ))}
        </ol>
      )}
      {board.teamStandings && board.teamStandings.length > 0 && (
        <>
          <h3 className="mt-2 text-base font-extrabold">{t('member.challenges.teams')}</h3>
          <ol className="flex flex-col tabular-nums">
            {board.teamStandings.map((s, i) => (
              <li key={s.teamId ?? s.name} className="flex gap-3.5 border-b border-[#1e293b] px-3 py-2"><span className="w-7 font-bold">{s.rank ?? i + 1}</span><span className="flex-1">{s.name}</span>{s.fraction != null && <span>{Math.round(s.fraction * 100)}%</span>}</li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
