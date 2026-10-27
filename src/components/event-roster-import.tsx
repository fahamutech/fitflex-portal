'use client';
import { useState } from 'react';
import { Download, Upload } from 'lucide-react';
import type { ParticipantFields, PublicEventDetail } from '@/lib/api';
import { GENDERS, KIT_SIZES, ROSTER_COLUMNS, ROSTER_EXAMPLE_CSV, ROSTER_MAX_BYTES, ROSTER_MAX_ROWS, appendRosterRow, fmt, rosterRowCount } from '@/lib/events';
import { Alert, Button, Field, Input, Select, Textarea } from '@/components/shared';
import { useApp } from '../../app/providers';

type RowValues = Record<(typeof ROSTER_COLUMNS)[number], string>;
const EMPTY_ROW: RowValues = { 'first name': '', 'last name': '', phone: '', email: '', category: '', 'date of birth': '', gender: '', 'kit size': '', group: '' };

/**
 * S3 §6.2 step 2 "People": a copy of the B2B `PeopleImport` entry with the event columns. The textarea is the single
 * source of truth: the CSV upload replaces it, "Add a row" appends to it, and "Check list" sends it as `rawText` to
 * the roster dry run. Nothing leaves the tab until the order is placed (§7.3).
 */
export function EventRosterImport({ text, onText, event, fields, busy, onCheck, serverError }: {
  text: string; onText: (v: string) => void; event: PublicEventDetail | null; fields: ParticipantFields; busy: boolean; onCheck: () => void; serverError: string | null;
}) {
  const { t } = useApp();
  const [fileError, setFileError] = useState<string | null>(null);
  const [row, setRow] = useState<RowValues>({ ...EMPTY_ROW });
  const [adding, setAdding] = useState(false);
  const rows = rosterRowCount(text);
  const tooMany = rows > ROSTER_MAX_ROWS;
  const categories = (event?.categories ?? []).filter(c => c.ticketTypes?.length);
  const ageRuled = categories.filter(c => c.minAge != null && c.minAge > 0).map(c => c.name);

  const required: string[] = [t('corp.events.col.firstName'), t('corp.events.col.lastName')];
  if (fields.phone === 'required') required.push(t('events.terms.fields.phone'));
  if (fields.email === 'required') required.push(t('events.terms.fields.email'));
  required.push(t('corp.events.col.category'));
  if (fields.dateOfBirth === 'required') required.push(t('corp.events.col.dob'));
  if (fields.gender === 'required') required.push(t('events.terms.fields.gender'));
  if (fields.kitSize === 'required') required.push(t('corp.events.col.kit'));
  if (fields.phone !== 'required' && fields.email !== 'required') required.push(t('events.validation.contact_required'));

  const pick = async (file?: File | null) => {
    if (!file) return;
    setFileError(null);
    if (file.size > ROSTER_MAX_BYTES) { setFileError(t('corp.events.fileTooBig')); return; }
    const content = await file.text();
    onText(content);
  };
  const download = () => {
    const blob = new Blob([ROSTER_EXAMPLE_CSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'events-roster-example.csv'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const addRow = () => {
    if (!row['first name'].trim() && !row['last name'].trim()) return;
    onText(appendRosterRow(text, row));
    setRow({ ...EMPTY_ROW });
    setAdding(false);
  };
  const setCell = (k: keyof RowValues, v: string) => setRow(r => ({ ...r, [k]: v }));

  return (
    <div className="space-y-4" data-testid="roster-import">
      <Alert tone="info">{t('corp.events.noReload')}</Alert>
      <div className="rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-3 text-sm text-[var(--color-fg-secondary)]" data-testid="roster-help">
        <p>{t('corp.events.columns')}</p>
        <p className="mt-1">{fmt(t('corp.events.requiredFor'), { list: required.join(', ') })}{ageRuled.length ? ` (${fmt(t('corp.events.ageRule'), { categories: ageRuled.join(', ') })})` : ''}</p>
        {categories.length > 0 && <p className="mt-1">{fmt(t('corp.events.categoriesAre'), { list: categories.map(c => c.name).join(', ') })}</p>}
      </div>
      <Field label={t('corp.events.paste')} hint={fmt(t('corp.events.rowCount'), { n: rows, max: ROSTER_MAX_ROWS })} error={tooMany ? t('events.error.too_many_rows') : undefined}>
        <Textarea className="font-mono text-xs" rows={8} value={text} onChange={e => onText(e.target.value)} placeholder={ROSTER_EXAMPLE_CSV} data-testid="roster-text" />
      </Field>
      <p className="-mt-2 text-xs text-[var(--color-fg-quaternary)]" data-testid="roster-headers-note">{t('corp.events.headersEnglish')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <Upload aria-hidden="true" className="h-4 w-4" />
          <span>{t('corp.events.upload')}</span>
          <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={e => { void pick(e.target.files?.[0]); e.target.value = ''; }} aria-label={t('corp.events.upload')} data-testid="roster-file" />
        </label>
        <Button type="button" variant="ghost" size="sm" onClick={download} data-testid="roster-example"><Download aria-hidden="true" className="h-4 w-4" />{t('corp.events.example')}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(a => !a)} aria-expanded={adding} data-testid="roster-add-toggle">{t('corp.events.addRow')}</Button>
      </div>
      {fileError && <Alert tone="error">{fileError}</Alert>}
      {adding && (
        <fieldset className="space-y-3 rounded-[var(--radius-xl)] border border-[var(--color-border-secondary)] p-3" data-testid="roster-add-row">
          <legend className="px-1 text-sm font-medium text-[var(--color-fg-secondary)]">{t('corp.events.addRow')}</legend>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Field label={t('corp.events.col.firstName')} required><Input size="sm" value={row['first name']} onChange={e => setCell('first name', e.target.value)} data-testid="roster-add-first" /></Field>
            <Field label={t('corp.events.col.lastName')} required><Input size="sm" value={row['last name']} onChange={e => setCell('last name', e.target.value)} data-testid="roster-add-last" /></Field>
            <Field label={t('events.terms.fields.phone')} required={fields.phone === 'required'}><Input size="sm" type="tel" inputMode="tel" value={row.phone} onChange={e => setCell('phone', e.target.value)} data-testid="roster-add-phone" /></Field>
            <Field label={t('events.terms.fields.email')} required={fields.email === 'required'}><Input size="sm" type="email" inputMode="email" value={row.email} onChange={e => setCell('email', e.target.value)} data-testid="roster-add-email" /></Field>
            <Field label={t('corp.events.col.category')} required>
              <Select size="sm" value={row.category} onChange={e => setCell('category', e.target.value)} data-testid="roster-add-category">
                <option value="">—</option>
                {categories.map(c => <option key={c.id ?? c.name} value={c.name}>{c.name}</option>)}
              </Select>
            </Field>
            {fields.dateOfBirth !== 'off' && <Field label={t('corp.events.col.dob')} required={fields.dateOfBirth === 'required'}><Input size="sm" type="date" value={row['date of birth']} onChange={e => setCell('date of birth', e.target.value)} data-testid="roster-add-dob" /></Field>}
            {fields.gender !== 'off' && (
              <Field label={t('events.terms.fields.gender')} required={fields.gender === 'required'}>
                <Select size="sm" value={row.gender} onChange={e => setCell('gender', e.target.value)}>
                  <option value="">—</option>
                  {GENDERS.map(g => <option key={g} value={g}>{t(`corp.events.gender.${g}` as 'corp.events.gender.male')}</option>)}
                </Select>
              </Field>
            )}
            {fields.kitSize !== 'off' && (
              <Field label={t('corp.events.col.kit')} required={fields.kitSize === 'required'}>
                <Select size="sm" value={row['kit size']} onChange={e => setCell('kit size', e.target.value)}>
                  <option value="">—</option>
                  {KIT_SIZES.map(k => <option key={k} value={k}>{k.toUpperCase()}</option>)}
                </Select>
              </Field>
            )}
            <Field label={t('corp.events.col.group')}><Input size="sm" value={row.group} onChange={e => setCell('group', e.target.value)} maxLength={80} data-testid="roster-add-group" /></Field>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={addRow} disabled={!row['first name'].trim() || !row['last name'].trim()} data-testid="roster-add-confirm">{t('events.common.add')}</Button>
        </fieldset>
      )}
      {serverError && <div data-testid="roster-server-error"><Alert tone="error">{serverError}</Alert></div>}
      <Button type="button" onClick={onCheck} loading={busy} disabled={!text.trim() || tooMany} data-testid="roster-check">{t('corp.events.check')}</Button>
    </div>
  );
}
