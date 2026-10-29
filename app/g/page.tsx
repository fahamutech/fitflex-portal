'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Globe, MapPin, ShieldCheck, Star } from 'lucide-react';
import { useApp } from '../providers';
import { Badge, Button, Card, CardContent, CardHeader } from '@/components/shared';
import { WEB_GYM_PROFILE } from '@/lib/flags';
import { fmt } from '@/lib/vendor';
import { hoursView, mapUrl, resolveWebGym, safeImage, type WebGymProfile } from '@/lib/web-gym';
import type { MessageKey } from '@/lib/i18n';

type View =
  | { kind: 'loading' }
  | { kind: 'ok'; profile: WebGymProfile }
  | { kind: 'not_found' }
  | { kind: 'rate_limited'; retryAfterSeconds: number | null }
  | { kind: 'error' };


/** A section heading plus its content; nothing at all when there is nothing to show. */
function Section({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }) {
  return (
    <section data-testid={testId} aria-label={title}>
      <Card>
        <CardHeader><h2 className="text-base font-semibold text-[var(--color-fg-primary)]">{title}</h2></CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </section>
  );
}

function Chips({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((x, i) => <li key={`${x}-${i}`}><Badge tone="gray">{x}</Badge></li>)}
    </ul>
  );
}

export default function PublicGymPage() {
  const { ready, locale, setLocale, t } = useApp();
  const [view, setView] = useState<View>({ kind: 'loading' });
  // The signed code lives only in memory: read once from the address, then removed from the address bar.
  const qRef = useRef<string | null | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const langChosen = useRef(false);
  const inflightLang = useRef<string | null>(null);

  // Language: the saved choice is applied by the app; with none, follow the browser once.
  useEffect(() => {
    if (!ready || langChosen.current) return;
    langChosen.current = true;
    let saved: string | null = null;
    try { saved = localStorage.getItem('locale'); } catch { /* storage blocked */ }
    if (saved !== 'en' && saved !== 'sw') {
      const nav = (typeof navigator !== 'undefined' ? navigator.language : '') || '';
      if (nav.toLowerCase().startsWith('sw') && locale !== 'sw') setLocale('sw');
    }
  }, [ready, locale, setLocale]);

  const load = useCallback(async (retry = false) => {
    const q = qRef.current;
    if (!q) { setView({ kind: 'not_found' }); return; }
    // One request per language: an effect that runs twice (development) must not ask twice.
    if (!retry && inflightLang.current === locale) return;
    inflightLang.current = locale;
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setView(v => (v.kind === 'ok' ? v : { kind: 'loading' }));
    const r = await resolveWebGym(q, locale, ctl.signal);
    if (ctl.signal.aborted) return;
    if (r.kind !== 'ok') inflightLang.current = null;
    setView(r.kind === 'ok' ? { kind: 'ok', profile: r.profile } : r);
  }, [locale]);

  useEffect(() => {
    if (!ready) return;
    if (!WEB_GYM_PROFILE) { setView({ kind: 'not_found' }); return; }
    if (qRef.current === undefined) {
      let q: string | null = null;
      try { q = new URLSearchParams(window.location.search).get('q'); } catch { /* unreadable address */ }
      qRef.current = q && q.trim() ? q : null;
      if (q !== null || window.location.search) {
        // Keep the code out of the address bar, history entry and anything copied from it.
        try { window.history.replaceState(window.history.state, '', window.location.pathname); } catch { /* not allowed: leave it */ }
      }
    }
    void load();
  }, [ready, load]);

  const toggle = (
    <button
      type="button"
      data-testid="web-gym-lang-toggle"
      onClick={() => setLocale(locale === 'sw' ? 'en' : 'sw')}
      aria-label={`${t('web.gym.langToggle')}: ${t(locale === 'sw' ? 'web.gym.switchToEn' : 'web.gym.switchToSw')}`}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-md)] px-3 text-xs font-semibold text-[var(--color-fg-secondary)] hover:bg-[var(--color-bg-tertiary)]"
    >
      <Globe aria-hidden="true" className="h-4 w-4" />
      <span aria-hidden="true">{locale === 'sw' ? 'SW' : 'EN'}</span>
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-10 pt-3" data-testid="web-gym-page">
      <div className="flex justify-end">{toggle}</div>
      <div role="status" aria-live="polite">
        {view.kind === 'loading' && WEB_GYM_PROFILE && (
          <p className="py-16 text-center text-sm text-[var(--color-fg-tertiary)]" data-testid="web-gym-loading">{t('web.gym.loading')}</p>
        )}
      </div>
      {view.kind === 'not_found' && (
        <div className="py-12 text-center" data-testid="web-gym-not-found">
          <h1 className="text-xl font-semibold text-[var(--color-fg-primary)]">{t('web.gym.notFound')}</h1>
          <p className="mt-2 text-sm text-[var(--color-fg-tertiary)]">{t('web.gym.notFoundBody')}</p>
        </div>
      )}
      {view.kind === 'rate_limited' && (
        <div className="space-y-3 py-12 text-center" data-testid="web-gym-rate-limited">
          <h1 className="text-xl font-semibold text-[var(--color-fg-primary)]">{t('web.gym.rateLimited')}</h1>
          <p className="text-sm text-[var(--color-fg-tertiary)]">
            {fmt(t('web.gym.rateLimitedHint'), { n: view.retryAfterSeconds ?? 60 })}
          </p>
          <Button onClick={() => void load(true)}>{t('web.gym.retry')}</Button>
        </div>
      )}
      {view.kind === 'error' && (
        <div className="space-y-3 py-12 text-center" data-testid="web-gym-error">
          <h1 className="text-xl font-semibold text-[var(--color-fg-primary)]">{t('web.gym.errorTitle')}</h1>
          <p className="text-sm text-[var(--color-fg-tertiary)]">{t('web.gym.errorBody')}</p>
          <Button onClick={() => void load(true)}>{t('web.gym.retry')}</Button>
        </div>
      )}
      {view.kind === 'ok' && <Profile profile={view.profile} />}
    </div>
  );
}

function Profile({ profile }: { profile: WebGymProfile }) {
  const { t, locale } = useApp();
  const g = profile.gym;
  const name = g.name ?? '';
  const photos = (g.photos ?? []).map(x => safeImage(x)).filter((x): x is string => !!x);
  const facilities = g.facilities ?? [];
  const amenities = (g.amenities ?? []).filter(a => !facilities.includes(a));
  const equipment = g.equipment ?? [];
  const classes = g.classes ?? [];
  // Services repeat the class names today; show them only when there is no classes section.
  const services = classes.length ? [] : (g.services ?? []);
  const trainers = g.trainers ?? [];
  const plans = profile.membership?.gymPlans ?? [];
  const tiers = profile.membership?.passTiers ?? [];
  const hours = hoursView(g.operatingHours);
  const map = mapUrl(g.lat, g.lng);
  const price = (n: number) => fmt(t('web.gym.price'), { amount: n.toLocaleString(locale === 'sw' ? 'sw-TZ' : 'en-US') });
  const rated = typeof g.rating === 'number' && g.rating > 0;
  const hasReviews = typeof g.reviewCount === 'number' && g.reviewCount > 0;

  return (
    <article className="space-y-4" data-testid="web-gym-profile">
      {photos.length > 0 && (
        <div
          className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4"
          data-testid="web-gym-photos"
          role="group"
          aria-label={name}
          tabIndex={0}
        >
          {photos.map((src, i) => (
            <div key={i} className="aspect-[4/3] w-[85%] shrink-0 snap-center overflow-hidden rounded-[var(--radius-xl)] bg-[var(--color-bg-tertiary)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={fmt(t('web.gym.photoAlt'), { name, n: i + 1 })}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            </div>
          ))}
        </div>
      )}

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-fg-primary)]" data-testid="web-gym-name">{name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {g.verified && <Badge tone="success"><ShieldCheck aria-hidden="true" className="mr-1 h-3.5 w-3.5" />{t('web.gym.verified')}</Badge>}
          {g.venueType === 'online' && <Badge tone="info">{t('web.gym.online')}</Badge>}
          {rated && (
            <span className="inline-flex items-center gap-1 text-sm text-[var(--color-fg-secondary)]" data-testid="web-gym-rating">
              <Star aria-hidden="true" className="h-4 w-4 text-[var(--color-warning-500)]" />
              {(g.rating as number).toFixed(1)}
              {hasReviews && <span className="text-[var(--color-fg-tertiary)]">({g.reviewCount === 1 ? t('web.gym.reviewsOne') : fmt(t('web.gym.reviews'), { n: g.reviewCount as number })})</span>}
            </span>
          )}
        </div>
        {g.address && (
          <p className="flex items-start gap-1.5 text-sm text-[var(--color-fg-tertiary)]" data-testid="web-gym-address">
            <MapPin aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span><span className="sr-only">{t('web.gym.address')}: </span>{g.address}</span>
          </p>
        )}
      </header>

      <div className="space-y-2">
        <Button size="lg" className="w-full" disabled aria-describedby="web-gym-visit-hint" data-testid="web-gym-visit">
          {t('web.gym.visit')}
        </Button>
        <p id="web-gym-visit-hint" className="text-center text-xs text-[var(--color-fg-tertiary)]" data-testid="web-gym-visit-hint">
          {t('web.gym.signInToVisit')}
        </p>
      </div>

      {g.description && (
        <Section title={t('web.gym.about')} testId="web-gym-about">
          <p className="whitespace-pre-line text-sm text-[var(--color-fg-secondary)]">{g.description}</p>
        </Section>
      )}

      {(g.directions || map) && (
        <Section title={t('web.gym.directionsHeading')} testId="web-gym-directions">
          {g.directions && <p className="whitespace-pre-line text-sm text-[var(--color-fg-secondary)]">{g.directions}</p>}
          {map && (
            <a
              href={map}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              data-testid="web-gym-map-link"
              className={`inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border-primary)] px-4 text-sm font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-bg-tertiary)] ${g.directions ? 'mt-3' : ''}`}
            >
              <MapPin aria-hidden="true" className="h-4 w-4" />{t('web.gym.directions')}
            </a>
          )}
        </Section>
      )}

      {hours && (
        <Section title={t('web.gym.hours')} testId="web-gym-hours">
          {'text' in hours ? (
            <p className="text-sm text-[var(--color-fg-secondary)]">{hours.text}</p>
          ) : (
            <dl className="divide-y divide-[var(--color-border-secondary)] text-sm">
              {hours.rows.map(r => (
                <div key={r.day} className="flex justify-between py-1.5">
                  <dt className="text-[var(--color-fg-tertiary)]">{t(`web.gym.day.${r.day}` as MessageKey)}</dt>
                  <dd className="font-medium text-[var(--color-fg-primary)]">{r.text ?? t('web.gym.closed')}</dd>
                </div>
              ))}
            </dl>
          )}
        </Section>
      )}

      {plans.length > 0 && (
        <Section title={t('web.gym.plans')} testId="web-gym-plans">
          <ul className="divide-y divide-[var(--color-border-secondary)]">
            {plans.map(p => (
              <li key={p.plan} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-sm">
                <span className="font-medium text-[var(--color-fg-primary)]">{p.label}</span>
                <span className="text-[var(--color-fg-secondary)]">{price(p.priceTzs)} <span className="text-[var(--color-fg-tertiary)]">{p.period}</span></span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {tiers.length > 0 && (
        <Section title={t('web.gym.passTiers')} testId="web-gym-pass-tiers">
          <ul className="divide-y divide-[var(--color-border-secondary)]">
            {tiers.map(p => (
              <li key={p.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-sm">
                <span className="font-medium text-[var(--color-fg-primary)]">{p.label}<span className="block font-normal text-[var(--color-fg-tertiary)]">{p.visitsLabel}</span></span>
                {typeof p.monthlyPriceTzs === 'number' && <span className="text-[var(--color-fg-secondary)]">{price(p.monthlyPriceTzs)}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {facilities.length > 0 && <Section title={t('web.gym.facilities')} testId="web-gym-facilities"><Chips items={facilities} /></Section>}
      {amenities.length > 0 && <Section title={t('web.gym.amenities')} testId="web-gym-amenities"><Chips items={amenities} /></Section>}
      {equipment.length > 0 && <Section title={t('web.gym.equipment')} testId="web-gym-equipment"><Chips items={equipment} /></Section>}
      {services.length > 0 && <Section title={t('web.gym.services')} testId="web-gym-services"><Chips items={services} /></Section>}

      {classes.length > 0 && (
        <Section title={t('web.gym.classes')} testId="web-gym-classes">
          <ul className="divide-y divide-[var(--color-border-secondary)]">
            {classes.map((c, i) => (
              <li key={`${c.name}-${i}`} className="py-2 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-[var(--color-fg-primary)]">{c.name}</span>
                  {typeof c.priceTzs === 'number' && <span className="text-[var(--color-fg-secondary)]">{price(c.priceTzs)}</span>}
                </div>
                {typeof c.schedule === 'string' && c.schedule && <p className="text-[var(--color-fg-tertiary)]">{c.schedule}</p>}
                {c.location && <p className="text-[var(--color-fg-tertiary)]">{c.location}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {trainers.length > 0 && (
        <Section title={t('web.gym.trainers')} testId="web-gym-trainers">
          <ul className="space-y-3">
            {trainers.filter(x => x.name).map((x, i) => {
              const photo = safeImage(x.photoUrl);
              return (
                <li key={`${x.name}-${i}`} className="flex items-center gap-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
                    {photo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo} alt={fmt(t('web.gym.trainerPhotoAlt'), { name: x.name ?? '' })} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-[var(--color-fg-primary)]">{x.name}</p>
                    {(x.specialties ?? []).length > 0 && <p className="truncate text-[var(--color-fg-tertiary)]">{x.specialties.join(', ')}</p>}
                  </div>
                  {typeof x.rating === 'number' && x.rating > 0 && (
                    <span className="ml-auto inline-flex items-center gap-1 text-sm text-[var(--color-fg-secondary)]">
                      <Star aria-hidden="true" className="h-4 w-4 text-[var(--color-warning-500)]" />{x.rating.toFixed(1)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <p className="rounded-[var(--radius-lg)] border border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)] px-4 py-3 text-xs text-[var(--color-fg-tertiary)]" data-testid="web-gym-not-proof">
        {t('web.gym.notProof')}
      </p>
    </article>
  );
}
