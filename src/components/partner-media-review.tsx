'use client';
// "Partner photos" queue (design spec photo-hero-screens §43.1–§43.4; backend functions#277).
//
// Post-moderation: partner uploads are live at once; admins check them here and mark them "Looks fine" or
// take them down with a reason. `moderation` views; `moderation_decide` acts. Items FitFlex set (origin
// fitflex) never enter To review.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ImageUp } from 'lucide-react';
import { useApp } from '../../app/providers';
import { ApiError } from '@/lib/api';
import {
  eatDateTime, fillTemplate as fill, isNetworkError, KIND_KEY, partnerMediaApi, partnerMediaErrorText, reasonLabelKey, roleLabel,
  SUBJECT_PAGE, SUBJECT_TYPE_KEY,
  type PartnerMediaItem, type PartnerMediaKind, type PartnerMediaTab, type PartnerSubjectType,
} from '@/lib/partner-media';
import type { MessageKey } from '@/lib/i18n';
import {
  Alert, Badge, Button, Card, CardContent, EmptyState, ErrorState, Input, PageHeader, Segmented, Select, SkeletonCard, useToast,
} from './shared';
import { Dialog, DialogFooter } from './dialog';
import {
  BandFigure, BothPlates, CompanionStore, DANGER_GHOST, FileDeleted, itemAlt, PartnerCompanionProvider, PartnerPreviewProvider, reportActionError,
  subjectName, TakedownDialog, useCompanion, useInView, usePreview,
} from './partner-media-shared';

type T = (key: MessageKey) => string;
type Status = 'loading' | 'ready' | 'off' | 'error';
const PAGE = 24;
const TABS: Array<[PartnerMediaTab, MessageKey]> = [
  ['to_review', 'partnerMedia.tab.toReview'], ['live', 'partnerMedia.tab.live'], ['taken_down', 'partnerMedia.tab.takenDown'],
];
const EMPTY_KEY: Record<PartnerMediaTab, MessageKey> = {
  to_review: 'partnerMedia.empty.toReview', live: 'partnerMedia.empty.live', taken_down: 'partnerMedia.empty.takenDown',
};

/** "Uploaded … by … (role)" or "Set by FitFlex, …, …". */
function originLine(t: T, item: PartnerMediaItem, locale: 'en' | 'sw') {
  const time = eatDateTime(item.createdAt, locale);
  const name = item.uploadedByName || t('partnerMedia.unknownPerson');
  return item.origin === 'fitflex'
    ? fill(t('partnerMedia.setByFitflex'), { time, name })
    : fill(t('partnerMedia.uploadedBy'), { time, name, role: roleLabel(t, item.uploadedByRole) });
}

/** The card's preview: the band (photos), or the logo on both plates plus a small band (logos). */
function CardPreview({ item }: { item: PartnerMediaItem }) {
  const { t } = useApp();
  const [ref, seen] = useInView<HTMLDivElement>();
  const logo = item.kind === 'logo';
  const isLive = item.status === 'live' && !!item.previewUrl;
  const p = usePreview(isLive ? item : null, logo ? 240 : 480, seen);
  // §43.2: the partner's live logo plate over the photo, or the logo's plate over the partner's live photo.
  const companion = useCompanion(isLive ? item : null, seen);
  const c = usePreview(companion, logo ? 480 : 240, seen);
  if (!isLive) return <div ref={ref}><FileDeleted /></div>;
  const plateOf = (i: PartnerMediaItem, src?: string) => ({ src, tone: (i.plate === 'dark' ? 'dark' : 'light') as 'light' | 'dark' });
  return (
    <div ref={ref} className="space-y-3" data-testid="partner-card-preview">
      {p.failed && <p className="text-sm text-[var(--color-error-700)]">{t('partnerMedia.preview.failed')}</p>}
      {!p.url && !p.failed && <p className="text-sm text-[var(--color-fg-tertiary)]">{t('partnerMedia.preview.loading')}</p>}
      {p.url && <span className="sr-only" data-testid="partner-card-alt">{itemAlt(t, item)}</span>}
      {logo ? (
        <>
          <BothPlates src={p.url} alt={itemAlt(t, item)} />
          <BandFigure kind="band" subject={item.subject} photoSrc={companion ? c.url : undefined} focal={companion?.focal} logo={plateOf(item, p.url)} />
        </>
      ) : (
        <BandFigure kind="band" subject={item.subject} photoSrc={p.url} focal={item.focal} logo={companion ? plateOf(companion, c.url) : null} />
      )}
    </div>
  );
}

/** Looks fine / Take down, or the "needs Moderation: decide" hint. */
function Actions({ item, tab, canDecide, busy, onReviewed, onTakeDown }: {
  item: PartnerMediaItem; tab: PartnerMediaTab; canDecide: boolean; busy: boolean;
  onReviewed: (i: PartnerMediaItem) => void; onTakeDown: (i: PartnerMediaItem) => void;
}) {
  const { t } = useApp();
  if (tab === 'taken_down' || item.status !== 'live') return null;
  const showLooksFine = tab === 'to_review' || item.review.state === 'to_review';
  const own = !!item.ownUpload;
  const hintId = `partner-hint-${item.id}`;
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {showLooksFine && (
          <Button
            variant="secondary" className="min-h-11 w-full sm:w-auto"
            disabled={!canDecide || own} loading={busy}
            aria-describedby={!canDecide || own ? hintId : undefined}
            onClick={() => onReviewed(item)}
            data-testid={`partner-looks-fine-${item.id}`}
          >
            {t('partnerMedia.looksFine')}
          </Button>
        )}
        <Button
          variant="ghost" className={`min-h-11 w-full sm:w-auto ${DANGER_GHOST}`}
          disabled={!canDecide || busy}
          aria-describedby={!canDecide ? hintId : undefined}
          onClick={() => onTakeDown(item)}
          data-testid={`partner-take-down-${item.id}`}
        >
          {t('partnerMedia.takeDown')}
        </Button>
      </div>
      {!canDecide
        ? <p id={hintId} className="text-xs text-[var(--color-fg-tertiary)]">{t('partnerMedia.noDecide')}</p>
        : own && showLooksFine && <p id={hintId} className="text-xs text-[var(--color-fg-tertiary)]" data-testid={`partner-own-upload-${item.id}`}>{t('partnerMedia.ownUpload')}</p>}
    </div>
  );
}

function Meta({ item, tab }: { item: PartnerMediaItem; tab: PartnerMediaTab }) {
  const { t, locale } = useApp();
  const lines: ReactNode[] = [<p key="o">{originLine(t, item, locale)}</p>];
  if (tab === 'live' && item.review.state === 'reviewed' && item.origin === 'partner') {
    lines.push(<p key="r">{fill(t('partnerMedia.reviewedBy'), { name: item.review.byName || t('partnerMedia.unknownPerson'), time: eatDateTime(item.review.at, locale) })}</p>);
  }
  if (item.takedown) {
    lines.push(
      <p key="reason" className="font-medium text-[var(--color-fg-primary)]" data-testid="partner-takedown-reason">{t(reasonLabelKey(item.takedown.reason))}</p>,
      ...(item.takedown.note ? [<p key="note" className="[overflow-wrap:anywhere]" data-testid="partner-takedown-note-text">{item.takedown.note}</p>] : []),
      <p key="by">{fill(t('partnerMedia.takenDownBy'), { name: item.takedown.byName || t('partnerMedia.unknownPerson'), time: eatDateTime(item.takedown.at, locale) })}</p>,
    );
  }
  return <div className="space-y-1 text-xs text-[var(--color-fg-tertiary)]">{lines}</div>;
}

function Badges({ item }: { item: PartnerMediaItem }) {
  const { t } = useApp();
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge tone="gray">{t(SUBJECT_TYPE_KEY[item.subject.type])}</Badge>
      <Badge tone="brand">{t(KIND_KEY[item.kind])}</Badge>
      {item.kind === 'hero' && item.bright && <Badge tone="warning">{t('partnerMedia.bright')}</Badge>}
    </span>
  );
}

function ItemCard({ item, tab, canDecide, busy, onOpen, onReviewed, onTakeDown }: {
  item: PartnerMediaItem; tab: PartnerMediaTab; canDecide: boolean; busy: boolean;
  onOpen: (i: PartnerMediaItem) => void; onReviewed: (i: PartnerMediaItem) => void; onTakeDown: (i: PartnerMediaItem) => void;
}) {
  const { t } = useApp();
  return (
    <li data-testid={`partner-card-${item.id}`} data-kind={item.kind}>
      <Card className="h-full">
        <CardContent className="flex h-full flex-col gap-3">
          <CardPreview item={item} />
          <div className="space-y-1.5">
            <h3 className="text-base font-semibold text-[var(--color-fg-primary)]">
              <button
                type="button"
                className="min-h-11 text-left underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-600)] [overflow-wrap:anywhere]"
                onClick={() => onOpen(item)}
                data-testid={`partner-open-${item.id}`}
              >
                {subjectName(t, item.subject)}
              </button>
            </h3>
            <Badges item={item} />
          </div>
          <Meta item={item} tab={tab} />
          <div className="mt-auto">
            <Actions item={item} tab={tab} canDecide={canDecide} busy={busy} onReviewed={onReviewed} onTakeDown={onTakeDown} />
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

/** Both previews at full size plus who confirmed what (§43.2 "Open"). The companion photo or logo is looked up once. */
function DetailDialog({ item, tab, canDecide, busy, onClose, onReviewed, onTakeDown }: {
  item: PartnerMediaItem | null; tab: PartnerMediaTab; canDecide: boolean; busy: boolean;
  onClose: () => void; onReviewed: (i: PartnerMediaItem) => void; onTakeDown: (i: PartnerMediaItem) => void;
}) {
  const { t, locale } = useApp();
  const companion = useCompanion(item?.status === 'live' ? item : null) ?? null;
  const own = usePreview(item?.status === 'live' ? item : null, 960);
  const other = usePreview(companion, 960);
  if (!item) return null;
  const photo = item.kind === 'hero' ? { src: own.url, focal: item.focal } : companion ? { src: other.url, focal: companion.focal } : null;
  const logoItem = item.kind === 'logo' ? item : companion;
  const logo = logoItem ? { src: item.kind === 'logo' ? own.url : other.url, tone: (logoItem.plate === 'dark' ? 'dark' : 'light') as 'light' | 'dark' } : null;
  const page = SUBJECT_PAGE[item.subject.type];
  return (
    <Dialog open onClose={onClose} title={itemAlt(t, item)} description={originLine(t, item, locale)} size="xl">
      <div className="space-y-5" data-testid="partner-detail">
        <Badges item={item} />
        {item.status === 'live' ? (
          <div className="space-y-4">
            {own.failed && <Alert tone="warning">{t('partnerMedia.preview.failed')}</Alert>}
            {item.kind === 'logo' && <BothPlates src={own.url} alt={itemAlt(t, item)} />}
            <BandFigure kind="band" subject={item.subject} photoSrc={photo?.src} focal={photo?.focal} logo={logo} />
            <BandFigure kind="wide" subject={item.subject} photoSrc={photo?.src} focal={photo?.focal} logo={logo} />
          </div>
        ) : <FileDeleted />}
        <div className="grid gap-2 text-sm sm:grid-cols-2" data-testid="partner-detail-facts">
          {item.width && item.height ? <p>{fill(t('partnerMedia.pixelSize'), { w: item.width, h: item.height })}</p> : null}
          {item.confirmationVersion && <p>{fill(t('partnerMedia.confirmationVersion'), { v: item.confirmationVersion })}</p>}
          {item.rightsConfirmedAt && (
            <p>{fill(t('partnerMedia.rightsConfirmed'), { name: item.rightsConfirmedByName || t('partnerMedia.unknownPerson'), time: eatDateTime(item.rightsConfirmedAt, locale) })}</p>
          )}
          {item.kind === 'logo' && item.ownLogoConfirmedAt && (
            <p>{fill(t('partnerMedia.ownLogoConfirmed'), { name: item.ownLogoConfirmedByName || t('partnerMedia.unknownPerson'), time: eatDateTime(item.ownLogoConfirmedAt, locale) })}</p>
          )}
        </div>
        <Meta item={item} tab={tab} />
        <Link href={page.href} className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--color-brand-700)] underline-offset-4 hover:underline">
          {fill(t('partnerMedia.detail.openPage'), { page: t(page.labelKey) })}
        </Link>
        <Actions item={item} tab={tab} canDecide={canDecide} busy={busy} onReviewed={onReviewed} onTakeDown={onTakeDown} />
      </div>
      <DialogFooter>
        <Button variant="secondary" className="min-h-11" onClick={onClose}>{t('common.close')}</Button>
      </DialogFooter>
    </Dialog>
  );
}

function Queue() {
  const { t, token, hasPermission } = useApp();
  const toast = useToast();
  const canDecide = hasPermission('moderation_decide');
  const [tab, setTab] = useState<PartnerMediaTab>('to_review');
  const [type, setType] = useState<PartnerSubjectType | ''>('');
  const [kind, setKind] = useState<PartnerMediaKind | ''>('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Status>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<PartnerMediaItem[]>([]);
  const [next, setNext] = useState<number | string | null>(null);
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [opened, setOpened] = useState<PartnerMediaItem | null>(null);
  const [takingDown, setTakingDown] = useState<PartnerMediaItem | null>(null);
  const seq = useRef(0);
  const companions = useMemo(() => new CompanionStore(token), [token]);
  // useApp().t is a new function on every provider render: read it through a ref so loads re-run only when the filters change.
  const tRef = useRef(t);
  tRef.current = t;

  // Search waits 300 ms after the last key.
  useEffect(() => { const id = window.setTimeout(() => setQ(search), 300); return () => window.clearTimeout(id); }, [search]);

  const load = useCallback(async (quiet = false) => {
    if (!token) return;
    const mine = ++seq.current;
    if (!quiet) setStatus('loading');
    companions.clear(); // a reload may follow a takedown or replacement: look the partners up again
    const filters = { subjectType: type, kind, q };
    try {
      const [list, count] = await Promise.all([
        partnerMediaApi.list(token, { ...filters, tab, limit: PAGE }),
        tab === 'to_review' ? null : partnerMediaApi.list(token, { ...filters, tab: 'to_review', limit: 1 }).catch(() => null),
      ]);
      if (mine !== seq.current) return;
      setItems(list.items);
      setNext(list.next ?? null);
      setReviewCount(tab === 'to_review' ? list.total : count?.total ?? null);
      setStatus('ready');
    } catch (e) {
      if (mine !== seq.current) return;
      if (e instanceof ApiError && e.status === 404) { setStatus('off'); return; }
      const tt = tRef.current;
      setLoadError(isNetworkError(e) ? tt('partnerMedia.offline') : e instanceof ApiError && e.status === 403 ? tt('partnerMedia.error.forbidden') : null);
      setStatus('error');
    }
  }, [token, tab, type, kind, q, companions]);
  useEffect(() => { void load(); }, [load]);

  async function loadMore() {
    if (!token || next == null) return;
    setMoreBusy(true);
    try {
      const list = await partnerMediaApi.list(token, { subjectType: type, kind, q, tab, limit: PAGE, cursor: next });
      setItems(cur => [...cur, ...list.items.filter(i => !cur.some(c => c.id === i.id))]);
      setNext(list.next ?? null);
    } catch (e) {
      toast.error(partnerMediaErrorText(t, e));
    } finally {
      setMoreBusy(false);
    }
  }

  const drop = (id: string) => setItems(cur => cur.filter(i => i.id !== id));

  async function markReviewed(item: PartnerMediaItem) {
    if (!token) return;
    setBusyId(item.id);
    try {
      const res = await partnerMediaApi.reviewed(token, item.id, item.revision);
      toast.success(t('partnerMedia.looksFine.done'));
      if (tab === 'to_review') { drop(item.id); setReviewCount(n => (n == null ? n : Math.max(0, n - 1))); }
      else setItems(cur => cur.map(i => (i.id === item.id ? res.item : i)));
      setOpened(o => (o?.id === item.id ? null : o));
    } catch (e) {
      const outcome = reportActionError(t, toast, e, item.kind);
      if (outcome === 'gone') { drop(item.id); setOpened(null); }
      if (outcome === 'stale' || outcome === 'gone') void load(true);
    } finally {
      setBusyId(null);
    }
  }

  function afterTakedown(outcome: 'done' | 'stale' | 'gone', item: PartnerMediaItem) {
    setTakingDown(null);
    setOpened(null);
    if (outcome === 'done' || outcome === 'gone') drop(item.id);
    if (outcome === 'done' && item.review.state === 'to_review') setReviewCount(n => (n == null ? n : Math.max(0, n - 1)));
    void load(true);
  }

  const tabLabel = (id: PartnerMediaTab, key: MessageKey) => (id === 'to_review' && reviewCount != null ? `${t(key)} (${reviewCount})` : t(key));
  const tabName = t(TABS.find(([id]) => id === tab)![1]);

  let body: ReactNode;
  if (status === 'loading') {
    body = (
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" data-testid="partner-loading">
        {Array.from({ length: 6 }, (_, i) => <li key={i}><SkeletonCard /></li>)}
      </ul>
    );
  } else if (status === 'error') {
    body = <ErrorState title={t('partnerMedia.loadError')} message={loadError ?? undefined} onRetry={() => void load()} retryLabel={t('common.tryAgain')} />;
  } else if (!items.length) {
    body = <EmptyState icon={<ImageUp />} title={t(EMPTY_KEY[tab])} />;
  } else {
    body = (
      <>
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="partner-cards">
          {items.map(item => (
            <ItemCard
              key={item.id} item={item} tab={tab} canDecide={canDecide} busy={busyId === item.id}
              onOpen={setOpened} onReviewed={i => void markReviewed(i)} onTakeDown={setTakingDown}
            />
          ))}
        </ul>
        {next != null && (
          <div className="flex justify-center">
            <Button variant="secondary" className="min-h-11" onClick={() => void loadMore()} loading={moreBusy} data-testid="partner-load-more">{t('partnerMedia.loadMore')}</Button>
          </div>
        )}
      </>
    );
  }

  return (
    <PartnerCompanionProvider store={companions}>
    <div data-testid="partner-media-page">
      <PageHeader title={t('partnerMedia.title')} description={t('partnerMedia.subtitle')} />
      {status === 'off' ? (
        <EmptyState icon={<ImageUp />} title={t('partnerMedia.off.title')} body={t('partnerMedia.off.body')} />
      ) : (
        <div className="space-y-6">
          <Alert tone="info">{t('partnerMedia.scopeNote')}</Alert>
          <nav aria-label={t('partnerMedia.tabs')}>
            <Segmented
              value={tab}
              onChange={v => { setTab(v as PartnerMediaTab); setNext(null); }}
              options={TABS.map(([id, key]) => [id, tabLabel(id, key)])}
              className="w-fit max-w-full overflow-x-auto"
            />
          </nav>
          <div className="grid gap-3 sm:grid-cols-3">
            <Select aria-label={t('partnerMedia.filter.type')} value={type} onChange={e => setType(e.target.value as PartnerSubjectType | '')} className="min-h-11" data-testid="partner-filter-type">
              <option value="">{t('partnerMedia.filter.type.all')}</option>
              <option value="gym">{t('partnerMedia.filter.type.gym')}</option>
              <option value="trainer">{t('partnerMedia.filter.type.trainer')}</option>
              <option value="vendor">{t('partnerMedia.filter.type.vendor')}</option>
            </Select>
            <Select aria-label={t('partnerMedia.filter.kind')} value={kind} onChange={e => setKind(e.target.value as PartnerMediaKind | '')} className="min-h-11" data-testid="partner-filter-kind">
              <option value="">{t('partnerMedia.filter.kind.all')}</option>
              <option value="hero">{t('partnerMedia.filter.kind.hero')}</option>
              <option value="logo">{t('partnerMedia.filter.kind.logo')}</option>
            </Select>
            <Input type="search" aria-label={t('partnerMedia.search')} placeholder={t('partnerMedia.search')} value={search} onChange={e => setSearch(e.target.value)} className="min-h-11" data-testid="partner-search" />
          </div>
          <section aria-labelledby="partner-tab-heading" className="space-y-4">
            <h2 id="partner-tab-heading" className="sr-only">{tabName}</h2>
            {body}
          </section>
        </div>
      )}
      <DetailDialog
        item={opened} tab={tab} canDecide={canDecide} busy={!!opened && busyId === opened.id}
        onClose={() => setOpened(null)} onReviewed={i => void markReviewed(i)} onTakeDown={setTakingDown}
      />
      <TakedownDialog
        item={takingDown}
        onClose={() => setTakingDown(null)}
        onDone={(outcome) => { if (takingDown) afterTakedown(outcome, takingDown); }}
      />
    </div>
    </PartnerCompanionProvider>
  );
}

export function PartnerMediaReview() {
  return <PartnerPreviewProvider><Queue /></PartnerPreviewProvider>;
}
