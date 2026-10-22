'use client';
import { useId, useMemo, useState } from 'react';
import type { GeoArea } from '@/lib/api';
import { useApp } from '../../app/providers';
import { Button, Checkbox, Input, Radio } from './shared';
import { ancestors, areaLabel, coveringArea, indexAreas, nameSaysLevel, searchVisible } from '@/lib/vendor-areas';

type Props = {
  areas: GeoArea[];
  label: string;
  testId: string;
} & (
  | { mode: 'single'; value: string | null; onChange: (id: string | null) => void }
  | { mode: 'multi'; value: string[]; onChange: (ids: string[]) => void }
);

/**
 * Area picker for a vendor's "Based in" (single: cities and districts) or "Delivers to" (multi: any level;
 * the country = nationwide). Search keeps parents visible. In multi mode an area under a ticked one shows as
 * ticked and disabled, "Included in {parent}" (spec shop-home-phase2 §7.4).
 */
export function VendorAreaPicker(props: Props) {
  const { t } = useApp();
  const { areas, label, testId, mode } = props;
  const [query, setQuery] = useState('');
  const groupName = useId();
  const byId = useMemo(() => indexAreas(areas), [areas]);
  const visible = useMemo(() => searchVisible(areas, query), [areas, query]);
  const picked = mode === 'multi' ? props.value : props.value ? [props.value] : [];
  const levelName = (a: GeoArea) => t(`vendors.areas.level.${a.level}`);
  const nameOf = (a: GeoArea) => (a.level === 'country' ? t('vendors.areas.nationwide') : a.name);

  const children = (parentId: string | null) => areas.filter(a => a.parentId === parentId && (!visible || visible.has(a.id)));
  const roots = areas.filter(a => !a.parentId || !byId.has(a.parentId)).filter(a => !visible || visible.has(a.id));

  const toggle = (id: string) => {
    if (props.mode === 'multi') props.onChange(props.value.includes(id) ? props.value.filter(v => v !== id) : [...props.value, id]);
    else props.onChange(props.value === id ? null : id);
  };

  const row = (a: GeoArea, depth: number): React.ReactNode => {
    const parent = ancestors(a.id, byId).find(p => p.level !== 'country');
    // Skip the level word when the name already says it ("Zanzibar City" is not followed by "City").
    const level = nameSaysLevel(a, levelName(a)) ? null : levelName(a);
    const description = [level, parent?.name].filter(Boolean).join(' · ') || undefined;
    const indent = { paddingLeft: Math.min(depth, 4) * 16 };
    let control: React.ReactNode;
    if (mode === 'single') {
      // Based in: only cities and districts can be picked; regions and the country are headings.
      control = a.level === 'city' || a.level === 'district'
        ? <Radio name={groupName} label={a.name} description={description} checked={picked.includes(a.id)} onChange={() => toggle(a.id)} data-testid={`${testId}-${a.id}`} />
        : <p className="py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-quaternary)]">{nameOf(a)}</p>;
    } else {
      const cover = coveringArea(a.id, picked, byId);
      control = <Checkbox
        label={nameOf(a)}
        description={cover ? t('vendors.areas.included').replace('{parent}', nameOf(cover)) : description}
        checked={picked.includes(a.id) || !!cover}
        disabled={!!cover}
        onChange={() => toggle(a.id)}
        data-testid={`${testId}-${a.id}`}
      />;
    }
    const kids = children(a.id);
    return <li key={a.id}>
      <div style={indent}>{control}</div>
      {kids.length > 0 && <ul>{kids.map(c => row(c, depth + 1))}</ul>}
    </li>;
  };

  return <div className="space-y-2">
    <Input
      type="search"
      size="sm"
      value={query}
      onChange={e => setQuery(e.target.value)}
      placeholder={t('vendors.areas.search')}
      aria-label={`${label}: ${t('vendors.areas.search')}`}
      data-testid={`${testId}-search`}
    />
    <ul role="group" aria-label={label} className="max-h-64 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border-secondary)] px-3 py-1" data-testid={testId}>
      {roots.length === 0
        ? <li className="py-3 text-sm text-[var(--color-fg-quaternary)]">{t('vendors.areas.noMatch')}</li>
        : roots.map(r => row(r, 0))}
    </ul>
    <div className="flex items-start justify-between gap-2">
    <p className="text-xs text-[var(--color-fg-tertiary)] [overflow-wrap:anywhere]" aria-live="polite" data-testid={`${testId}-selected`}>
      {t('vendors.areas.selected').replace('{areas}', picked.length ? picked.map(id => byId.get(id)?.level === 'country' ? t('vendors.areas.nationwide') : areaLabel(id, byId)).join('; ') : t('vendors.areas.nothing'))}
    </p>
    {picked.length > 0 && <Button variant="ghost" size="sm" onClick={() => (props.mode === 'multi' ? props.onChange([]) : props.onChange(null))} data-testid={`${testId}-clear`}>{t('vendors.areas.clear')}</Button>}
    </div>
  </div>;
}
