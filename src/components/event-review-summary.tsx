'use client';
import { ReactNode } from 'react';
import type { EventDocument } from '@/lib/api';
import { money } from '@/lib/admin-utils';
import { distanceLabel, eventDateTime, fmt, stepKey, typeKey, type WizardStep } from '@/lib/events';
import { Button, Card, CardContent, CardHeader } from '@/components/shared';
import { useApp } from '../../app/providers';

/**
 * The read-only summary of an event in the member's order (spec §6.2 step 7 and §8.1): shared by the wizard's review
 * step and the admin queue. `lang` picks the description language (the admin's "Preview as member").
 */
export function EventReviewSummary({ doc, lang, onEdit }: { doc: EventDocument; lang: 'en' | 'sw'; onEdit?: (step: WizardStep) => void }) {
  const { t, locale } = useApp();
  const tz = doc.timezone;
  const abbr = doc.timezoneAbbr || null;
  const when = (iso: string | null | undefined) => (iso ? eventDateTime(iso, tz, locale, abbr) : t('events.review.noValue'));
  const text = (b: { en: string; sw: string } | null | undefined) => (b ? (lang === 'sw' ? b.sw || b.en : b.en) || t('events.review.noValue') : t('events.review.noValue'));
  const Section = ({ step, children }: { step: WizardStep; children: ReactNode }) => (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-[var(--color-fg-primary)]">{t(stepKey(step))}</h3>
        {onEdit && <Button variant="link" size="sm" onClick={() => onEdit(step)} aria-label={`${t('events.review.edit')}: ${t(stepKey(step))}`}>{t('events.review.edit')}</Button>}
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-[var(--color-fg-secondary)]">{children}</CardContent>
    </Card>
  );
  const Row = ({ label, value }: { label: string; value: ReactNode }) => (
    <div className="grid gap-1 sm:grid-cols-[200px_1fr]"><dt className="text-[var(--color-fg-quaternary)]">{label}</dt><dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd></div>
  );
  const virtual = doc.type === 'virtual';
  return (
    <div className="space-y-4" data-testid="event-review-summary">
      <Section step="basics">
        <dl className="space-y-2">
          <Row label={t('events.basics.title')} value={doc.title || t('events.review.noValue')} />
          <Row label={t('events.basics.type')} value={t(typeKey(doc.type))} />
          <Row label={t('events.basics.starts')} value={when(doc.startsAt)} />
          <Row label={t('events.basics.ends')} value={when(doc.endsAt)} />
          <Row label={t('events.basics.regOpens')} value={doc.registrationOpensAt ? when(doc.registrationOpensAt) : t('events.basics.regOpensHint')} />
          <Row label={t('events.basics.regCloses')} value={when(doc.registrationClosesAt)} />
          <Row label={lang === 'sw' ? t('events.basics.descriptionSw') : t('events.basics.descriptionEn')} value={<p className="whitespace-pre-line">{text(doc.description)}</p>} />
          {doc.heroImageUrl && <Row label={t('events.basics.cover')} value={<img src={doc.heroThumbUrl || doc.heroImageUrl} alt={doc.coverAlt ?? ''} className="h-24 w-auto rounded-[var(--radius-md)] object-cover" />} />}
        </dl>
      </Section>
      <Section step="venue">
        <dl className="space-y-2">
          {virtual && !doc.venue?.name ? <Row label={t('events.venue.name')} value={t('events.review.virtualVenue')} /> : <Row label={t('events.venue.name')} value={doc.venue?.name || t('events.review.noValue')} />}
          <Row label={t('events.venue.address')} value={[doc.venue?.address, doc.venue?.city, doc.venue?.region].filter(Boolean).join(', ') || t('events.review.noValue')} />
          <Row label={t('events.venue.pin')} value={doc.venue?.lat != null && doc.venue?.lng != null ? `${doc.venue.lat.toFixed(5)}, ${doc.venue.lng.toFixed(5)}` : t('events.review.noValue')} />
          {doc.routeUrl && <Row label={t('events.venue.routeUrl')} value={<a href={doc.routeUrl} target="_blank" rel="noreferrer" className="text-[var(--color-brand-700)] underline-offset-4 hover:underline">{doc.routeUrl}</a>} />}
          {doc.accessibility && <Row label={lang === 'sw' ? t('events.venue.accessSw') : t('events.venue.accessEn')} value={text(doc.accessibility)} />}
        </dl>
      </Section>
      <Section step="categories">
        {doc.categories.length === 0 ? <p>{t('events.review.noValue')}</p> : (
          <div className="overflow-x-auto">
            <table className="ui-table min-w-full" aria-label={t('events.wizard.step.categories')}>
              <thead><tr><th scope="col">{t('events.categories.name')}</th><th scope="col">{t('events.categories.distance')}</th><th scope="col">{t('events.categories.start')}</th><th scope="col">{t('events.categories.capacity')}</th><th scope="col">{t('events.tickets.price')}</th></tr></thead>
              <tbody>
                {doc.categories.map((c, i) => {
                  const prices = c.ticketTypes.map(tt => tt.priceTzs);
                  const min = prices.length ? Math.min(...prices) : null;
                  return (
                    <tr key={c.id ?? i}>
                      <td>{c.name}</td><td>{distanceLabel(c.distanceM)}</td><td>{c.startsAt ? when(c.startsAt) : '—'}</td><td>{c.capacity ?? t('events.categories.noLimit')}</td>
                      <td>{min == null ? '—' : min === 0 ? t('events.tickets.free') : fmt(t('events.review.from'), { amount: money(min, 'TZS') })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <Section step="tickets">
        {doc.categories.flatMap(c => c.ticketTypes.map(tt => ({ c, tt }))).length === 0 ? <p>{t('events.review.noValue')}</p> : (
          <ul className="space-y-1">
            {doc.categories.map((c, i) => (
              <li key={c.id ?? i}><span className="font-medium text-[var(--color-fg-primary)]">{c.name}</span>: {c.ticketTypes.map(tt => `${tt.name} · ${tt.priceTzs === 0 ? t('events.tickets.free') : money(tt.priceTzs, 'TZS')}`).join(' · ')}</li>
            ))}
          </ul>
        )}
      </Section>
      <Section step="kit">
        {doc.collectionPoints.length === 0 ? <p>{t('events.kit.none')}</p> : (
          <ul className="space-y-2">
            {doc.collectionPoints.map((p, i) => (
              <li key={p.id ?? i}>
                <p className="font-medium text-[var(--color-fg-primary)]">{p.name} · {p.address}</p>
                <p className="text-xs text-[var(--color-fg-quaternary)]">{p.windows.map(w => `${when(w.opensAt)} – ${when(w.closesAt)}`).join(' · ')}</p>
                <p>{text(p.instructions)}</p>
              </li>
            ))}
          </ul>
        )}
        {doc.inclusions && <p>{text(doc.inclusions)}</p>}
      </Section>
      <Section step="terms">
        <dl className="space-y-2">
          <Row label={t('events.terms.policy')} value={doc.refundPolicy?.preset ? t(`events.terms.policy.${doc.refundPolicy.preset}` as 'events.terms.policy.custom') : t('events.review.noValue')} />
          {doc.refundPolicy?.preset === 'custom' && <Row label={lang === 'sw' ? t('events.terms.policySw') : t('events.terms.policyEn')} value={text(doc.refundPolicy.text)} />}
          <Row label={t('events.terms.contactEmail')} value={doc.contact?.email || t('events.review.noValue')} />
          <Row label={t('events.terms.contactPhone')} value={doc.contact?.phone || '—'} />
          <Row label={t('events.terms.contactWhatsapp')} value={doc.contact?.whatsapp || '—'} />
          {doc.sponsors.length > 0 && <Row label={t('events.terms.sponsors')} value={doc.sponsors.map(sp => sp.name).join(', ')} />}
          {doc.schedule.length > 0 && <Row label={t('events.terms.schedule')} value={<ul>{doc.schedule.map((it, i) => <li key={it.id ?? i}>{when(it.at)} · {text(it.label)}</li>)}</ul>} />}
          <Row label={lang === 'sw' ? t('events.terms.termsSw') : t('events.terms.termsEn')} value={<details><summary className="cursor-pointer text-[var(--color-brand-700)]">{t('events.changes.details')}</summary><p className="mt-2 whitespace-pre-line">{text(doc.terms)}</p></details>} />
        </dl>
      </Section>
    </div>
  );
}
