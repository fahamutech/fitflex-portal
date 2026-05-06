'use client';
import { useState } from 'react';
import { Field } from '@/components/shared';
import { ImageUpload } from '@/components/image-upload';
import dynamic from 'next/dynamic';

const LocationPicker = dynamic(
  () => import('@/components/location-picker').then(m => ({ default: m.LocationPicker })),
  {
    ssr: false,
    loading: () => (
      <div className="h-[220px] rounded-xl bg-[var(--color-bg-tertiary)] flex items-center justify-center text-xs text-[var(--color-fg-quaternary)]">
        Loading map...
      </div>
    ),
  }
);

const TIERS = ['standard', 'midtier', 'premium', 'luxury_executive'];

export interface GymDraft {
  name: string;
  location: string;
  tier: string;
  ratePerDay: number;
  ratePerWeek: number;
  ratePerMonth: number;
  commissionRate: number;
  status: string;
  coordinates: { lat: number | null; lng: number | null };
  images: string[];
  paymentBank: string;
  paymentNumber: string;
  paymentNotes: string;
  tinNumber: string;
}

export const BLANK_GYM_DRAFT: GymDraft = {
  name: '',
  location: '',
  tier: 'standard',
  ratePerDay: 5000,
  ratePerWeek: 25000,
  ratePerMonth: 80000,
  commissionRate: 12,
  status: 'active',
  coordinates: { lat: -6.7924, lng: 39.2083 },
  images: [],
  paymentBank: '',
  paymentNumber: '',
  paymentNotes: '',
  tinNumber: '',
};

interface GymCreateFormProps {
  draft: GymDraft;
  onChange: (draft: GymDraft) => void;
  errors: Record<string, string>;
  onClearError: (key: string) => void;
  /** Additional fields rendered after images (e.g. owner/trainer selects) */
  extraFields?: React.ReactNode;
}

export function GymCreateForm({ draft, onChange, errors, onClearError, extraFields }: GymCreateFormProps) {
  function set<K extends keyof GymDraft>(key: K, value: GymDraft[K]) {
    onChange({ ...draft, [key]: value });
    onClearError(key);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Name" error={errors.name}>
          <input
            className="ui-input"
            value={draft.name}
            onChange={e => set('name', e.target.value)}
          />
        </Field>
        <Field label="Location" error={errors.location}>
          <input
            className="ui-input"
            value={draft.location}
            onChange={e => set('location', e.target.value)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Tier">
          <select
            className="ui-input"
            value={draft.tier}
            onChange={e => set('tier', e.target.value)}
          >
            {TIERS.map(t => (
              <option key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select
            className="ui-input"
            value={draft.status}
            onChange={e => set('status', e.target.value)}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Rate per day (TZS)" error={errors.ratePerDay}>
          <input
            className="ui-input"
            type="number"
            value={draft.ratePerDay || ''}
            placeholder="0"
            onChange={e => set('ratePerDay', e.target.value === '' ? 0 : Number(e.target.value))}
          />
        </Field>
        <Field label="Rate per week (TZS)" error={errors.ratePerWeek}>
          <input
            className="ui-input"
            type="number"
            value={draft.ratePerWeek || ''}
            placeholder="0"
            onChange={e => set('ratePerWeek', e.target.value === '' ? 0 : Number(e.target.value))}
          />
        </Field>
        <Field label="Rate per month (TZS)" error={errors.ratePerMonth}>
          <input
            className="ui-input"
            type="number"
            value={draft.ratePerMonth || ''}
            placeholder="0"
            onChange={e => set('ratePerMonth', e.target.value === '' ? 0 : Number(e.target.value))}
          />
        </Field>
      </div>

      <Field label="Commission %" error={errors.commissionRate}>
        <input
          className="ui-input"
          type="number"
          value={draft.commissionRate || ''}
          placeholder="0"
          onChange={e => set('commissionRate', e.target.value === '' ? 0 : Number(e.target.value))}
        />
      </Field>

      <Field label="Location on map" hint="Click the map or search to set the gym location." error={errors.lat}>
        <LocationPicker
          lat={draft.coordinates.lat}
          lng={draft.coordinates.lng}
          onChange={(lat, lng) => {
            onChange({ ...draft, coordinates: { lat, lng } });
            onClearError('lat');
          }}
          height="200px"
        />
      </Field>

      <Field label="Gym images" hint="Upload gym photos. PNG, JPG, or WEBP." error={errors.images}>
        <ImageUpload
          value={draft.images}
          onChange={(imgs) => {
            onChange({ ...draft, images: imgs });
            onClearError('images');
          }}
          maxFiles={5}
        />
      </Field>

      <h3 className="text-sm font-semibold text-[var(--color-fg-secondary)] pt-4">Payment & KYC details</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Bank / FSP">
          <input
            className="ui-input"
            value={draft.paymentBank}
            onChange={e => set('paymentBank', e.target.value)}
            placeholder="e.g. CRDB, NMB, M-Pesa"
          />
        </Field>
        <Field label="Payment number">
          <input
            className="ui-input"
            value={draft.paymentNumber}
            onChange={e => set('paymentNumber', e.target.value)}
            placeholder="Account or mobile number"
          />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Payment notes">
          <input
            className="ui-input"
            value={draft.paymentNotes}
            onChange={e => set('paymentNotes', e.target.value)}
            placeholder="Any notes for payment"
          />
        </Field>
        <Field label="TIN number">
          <input
            className="ui-input"
            value={draft.tinNumber}
            onChange={e => set('tinNumber', e.target.value)}
            placeholder="Tax ID (if registered)"
          />
        </Field>
      </div>

      {extraFields}
    </div>
  );
}

export function validateGymDraft(draft: GymDraft): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!draft.name?.trim()) errs.name = 'Name is required';
  if (!draft.location?.trim()) errs.location = 'Location is required';
  if (draft.ratePerDay == null || draft.ratePerDay <= 0) errs.ratePerDay = 'Day rate is required';
  if (draft.ratePerWeek == null || draft.ratePerWeek <= 0) errs.ratePerWeek = 'Week rate is required';
  if (draft.ratePerMonth == null || draft.ratePerMonth <= 0) errs.ratePerMonth = 'Month rate is required';
  if (draft.commissionRate == null || draft.commissionRate < 0) errs.commissionRate = 'Commission rate is required';
  if (draft.coordinates.lat == null) errs.lat = 'Location is required — use the map to set it';
  return errs;
}
