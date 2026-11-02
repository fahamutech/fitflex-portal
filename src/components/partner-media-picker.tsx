'use client';
// "Set photo for a partner" (functions#286 partner picker): find a gym, trainer or vendor by name and open the
// existing "Home photo and logo" dialog for it. Lets an admin with only brand_media set a partner's photo or logo
// without the gyms, trainers or vendors table scopes.
//
// - GET /admin/partner-media/subjects?type=&q=&limit= (moderation, moderation_decide or brand_media): names and ids
//   only. The search waits 300 ms after the last key and needs at least 2 characters (the server's minimum).
// - Keyboard: an ARIA combobox. Up / Down move through the matches, Home / End jump, Enter opens the highlighted
//   partner, Escape closes the list.
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useApp } from '../../app/providers';
import { ApiError } from '@/lib/api';
import {
  errorCode, fillTemplate as fill, isNetworkError, partnerMediaApi, SUBJECT_PAGE_SIZE, SUBJECT_QUERY_MIN, SUBJECT_TYPE_KEY,
  type PartnerSubject, type PartnerSubjectType,
} from '@/lib/partner-media';
import type { MessageKey } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { Badge, Field, Input, Select, Spinner } from './shared';

type T = (key: MessageKey) => string;
type Search =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'done'; items: PartnerSubject[]; total: number; q: string }
  | { state: 'error'; message: string };

/** What a refused search says (§44.2 errors; the picker's own rate-limit line). */
export function pickerErrorText(t: T, e: unknown): string {
  if (isNetworkError(e)) return t('partnerMedia.offline');
  const code = errorCode(e);
  if (code === 'feature_disabled') return t('partnerMedia.off.body');
  if (code === 'rate_limited') return t('partnerMedia.picker.rateLimited');
  if (code === 'q_too_short') return t('partnerMedia.picker.searchHint');
  if (e instanceof ApiError && e.status === 403) return t('partnerMedia.error.acl_forbidden');
  return t('partnerMedia.picker.failed');
}

export function PartnerPicker({ onPick }: { onPick: (subject: PartnerSubject) => void }) {
  const { t, token } = useApp();
  const [type, setType] = useState<PartnerSubjectType>('gym');
  const [text, setText] = useState('');
  const [search, setSearch] = useState<Search>({ state: 'idle' });
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  // useApp().t is a new function on every provider render: read it through a ref so a search is not repeated.
  const tRef = useRef(t);
  tRef.current = t;
  const baseId = useId();
  const listId = `${baseId}-list`;
  const hintId = `${baseId}-hint`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  useEffect(() => {
    const q = text.trim();
    const mine = ++seq.current;
    if (q.length < SUBJECT_QUERY_MIN || !token) { setSearch({ state: 'idle' }); setActive(-1); return; }
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearch({ state: 'loading' });
      try {
        const res = await partnerMediaApi.subjects(token, { type, q, limit: SUBJECT_PAGE_SIZE }, ctrl.signal);
        if (mine !== seq.current) return;
        setSearch({ state: 'done', items: res.items, total: res.total, q });
        setActive(res.items.length ? 0 : -1);
        setOpen(true);
      } catch (e) {
        if (mine !== seq.current || (e instanceof DOMException && e.name === 'AbortError')) return;
        setSearch({ state: 'error', message: pickerErrorText(tRef.current, e) });
        setActive(-1);
      }
    }, 300);
    return () => { window.clearTimeout(timer); ctrl.abort(); };
  }, [text, type, token]);

  const items = search.state === 'done' ? search.items : [];
  const expanded = open && items.length > 0;

  const pick = (i: number) => { const s = items[i]; if (s) { setOpen(false); onPick(s); } };
  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (!items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(i => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive(i => Math.max(0, i - 1)); }
    else if (e.key === 'Home' && expanded) { e.preventDefault(); setActive(0); }
    else if (e.key === 'End' && expanded) { e.preventDefault(); setActive(items.length - 1); }
    else if (e.key === 'Enter' && expanded && active >= 0) { e.preventDefault(); pick(active); }
    else if (e.key === 'Escape' && expanded) { e.preventDefault(); setOpen(false); }
  }

  let status: string;
  if (text.trim().length < SUBJECT_QUERY_MIN) status = t('partnerMedia.picker.searchHint');
  else if (search.state === 'loading' || search.state === 'idle') status = t('partnerMedia.picker.searching');
  else if (search.state === 'error') status = search.message;
  else if (!search.items.length) status = fill(t('partnerMedia.picker.none'), { q: search.q });
  else if (search.total > search.items.length) status = fill(t('partnerMedia.picker.more'), { shown: search.items.length, total: search.total });
  else status = '';

  return (
    <div className="space-y-3" data-testid="partner-picker">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <Field label={t('partnerMedia.filter.type')}>
          <Select value={type} onChange={e => { setType(e.target.value as PartnerSubjectType); setOpen(true); }} className="min-h-11" data-testid="partner-picker-type">
            <option value="gym">{t('partnerMedia.filter.type.gym')}</option>
            <option value="trainer">{t('partnerMedia.filter.type.trainer')}</option>
            <option value="vendor">{t('partnerMedia.filter.type.vendor')}</option>
          </Select>
        </Field>
        <Field label={t('partnerMedia.picker.search')}>
          <Input
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
            aria-describedby={hintId}
            autoComplete="off"
            value={text}
            onChange={e => { setText(e.target.value); setOpen(true); }}
            onKeyDown={onKeyDown}
            onFocus={() => setOpen(true)}
            className="min-h-11"
            data-autofocus
            data-testid="partner-picker-search"
          />
        </Field>
      </div>
      <p id={hintId} className="sr-only">{t('partnerMedia.picker.keys')}</p>
      <p
        className={cn('flex items-center gap-2 text-sm', search.state === 'error' ? 'text-[var(--color-error-700)]' : 'text-[var(--color-fg-tertiary)]')}
        aria-live="polite"
        data-testid="partner-picker-status"
      >
        {search.state === 'loading' && <Spinner className="h-4 w-4" />}
        {status}
      </p>
      <ul
        id={listId}
        role="listbox"
        aria-label={t('partnerMedia.picker.results')}
        hidden={!expanded}
        className="max-h-80 overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)]"
        data-testid="partner-picker-list"
      >
        {items.map((s, i) => (
          <li
            key={`${s.type}:${s.id}`}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            className={cn(
              'flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-2 text-sm text-[var(--color-fg-primary)] [overflow-wrap:anywhere]',
              i === active ? 'bg-[var(--color-bg-tertiary)]' : 'hover:bg-[var(--color-bg-secondary)]',
            )}
            // mousedown, not click: picking must not first blur the input and close the list.
            onMouseDown={e => { e.preventDefault(); pick(i); }}
            onMouseEnter={() => setActive(i)}
            data-testid={`partner-picker-option-${s.id}`}
          >
            <span>{s.name || s.id}</span>
            <Badge tone="gray">{t(SUBJECT_TYPE_KEY[s.type])}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
