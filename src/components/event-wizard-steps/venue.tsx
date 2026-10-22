'use client';
import dynamic from 'next/dynamic';
import { Checkbox, Field, Input, Select } from '@/components/shared';
import { ImageUpload } from '@/components/image-upload';
import { CountedTextarea, TextField, useErrorText, type StepProps } from './fields';
import { useApp } from '../../../app/providers';

const LocationPicker = dynamic(() => import('@/components/location-picker').then(m => ({ default: m.LocationPicker })), {
  ssr: false, loading: () => <div aria-busy="true" className="h-[260px] animate-pulse rounded-[var(--radius-lg)] bg-[var(--color-bg-tertiary)]" />,
});

/** Step 2 Venue & route (spec §6.2). */
export function VenueStep({ form, update, errors, readOnly, token, options }: StepProps) {
  const { t, locale } = useApp();
  const errText = useErrorText();
  const virtual = form.type === 'virtual';
  const regions = options?.regions ?? [];
  return (
    <div className="space-y-4">
      <TextField path="venueName" label={t('events.venue.name')} value={form.venueName} onChange={v => update({ venueName: v })} error={errors.venueName} required={!virtual} readOnly={readOnly} maxLength={120} hint={virtual ? t('events.venue.nameVirtualHint') : undefined} />
      <TextField path="venueAddress" label={t('events.venue.address')} value={form.venueAddress} onChange={v => update({ venueAddress: v })} error={errors.venueAddress} required={!virtual} readOnly={readOnly} maxLength={200} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField path="venueCity" label={t('events.venue.city')} value={form.venueCity} onChange={v => update({ venueCity: v })} error={errors.venueCity} readOnly={readOnly} maxLength={80} />
        <Field label={t('events.venue.region')} required={!virtual} error={errText(errors.venueRegion)}>
          {regions.length ? (
            <Select id="ev-venueRegion" value={form.venueRegion} onChange={e => update({ venueRegion: e.target.value })} disabled={readOnly} data-testid="ev-venueRegion">
              <option value="">—</option>
              {regions.map(r => <option key={r.code} value={r.code}>{locale === 'sw' ? r.name.sw || r.name.en : r.name.en}</option>)}
            </Select>
          ) : (
            <Input id="ev-venueRegion" value={form.venueRegion} onChange={e => update({ venueRegion: e.target.value })} disabled={readOnly} data-testid="ev-venueRegion" />
          )}
        </Field>
      </div>
      {!virtual && (
        <Field label={t('events.venue.pin')} required error={errText(errors.pin)}>
          <div id="ev-pin" tabIndex={-1} data-testid="ev-pin">
            {readOnly
              ? <p className="text-sm text-[var(--color-fg-secondary)]">{form.lat != null && form.lng != null ? `${form.lat.toFixed(5)}, ${form.lng.toFixed(5)}` : '—'}</p>
              : <LocationPicker lat={form.lat} lng={form.lng} onChange={(lat, lng) => update({ lat, lng })} height="260px" />}
          </div>
        </Field>
      )}
      {!virtual && <Checkbox label={t('events.venue.outsideTz')} checked={form.outsideTz} onChange={e => update({ outsideTz: e.target.checked })} disabled={readOnly} data-testid="ev-outsideTz" />}
      <TextField path="routeUrl" label={t('events.venue.routeUrl')} value={form.routeUrl} onChange={v => update({ routeUrl: v })} error={errors.routeUrl} readOnly={readOnly} type="url" inputMode="url" placeholder="https://" />
      <Field label={t('events.venue.routeImage')}>
        <div id="ev-routeImageUrl">
          <ImageUpload token={token} maxFiles={1} disabled={readOnly} value={form.routeImageUrl ? [form.routeImageUrl] : []} thumbnails={form.routeImageUrl ? [form.routeImageUrl] : []}
            onChange={imgs => update({ routeImageUrl: imgs[0] ?? '', ...(imgs[0] ? {} : { routeImageAlt: '' }) })} />
        </div>
      </Field>
      {form.routeImageUrl && <TextField path="routeImageAlt" label={t('events.basics.coverAlt')} value={form.routeImageAlt} onChange={v => update({ routeImageAlt: v })} error={errors.routeImageAlt} required readOnly={readOnly} maxLength={120} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <CountedTextarea path="accessEn" label={t('events.venue.accessEn')} value={form.accessEn} onChange={v => update({ accessEn: v })} error={errors.accessEn} readOnly={readOnly} rows={4} max={1000} />
        <CountedTextarea path="accessSw" label={t('events.venue.accessSw')} value={form.accessSw} onChange={v => update({ accessSw: v })} error={errors.accessSw} readOnly={readOnly} rows={4} max={1000} />
      </div>
    </div>
  );
}
