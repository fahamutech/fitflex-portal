'use client';
import type { GeoArea } from '@/lib/api';
import { areaPath } from '@/lib/promotions';

/**
 * Pick the areas a promotion or campaign reaches. Nothing picked means everywhere.
 * An area covers everything beneath it, so a region needs no cities ticked.
 */
export function AreaPicker({ areas, value, onChange }: { areas: GeoArea[]; value: string[]; onChange: (ids: string[]) => void }) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id]);
  const selectable = areas.filter(a => a.level !== 'country');
  // Parents before children so the list reads as a tree.
  const children = (parentId: string | null): GeoArea[] => selectable.filter(a => a.parentId === parentId);
  const render = (a: GeoArea, depth: number): React.ReactNode => (
    <li key={a.id}>
      <label className="flex cursor-pointer items-center gap-2 py-1 text-sm" style={{ paddingLeft: depth * 16 }}>
        <input type="checkbox" checked={value.includes(a.id)} onChange={() => toggle(a.id)} data-testid={`area-${a.id}`} />
        <span>{a.name}</span>
        <span className="text-xs text-[var(--color-fg-quaternary)]">{a.level}</span>
      </label>
      {children(a.id).length > 0 && <ul>{children(a.id).map(c => render(c, depth + 1))}</ul>}
    </li>
  );
  const roots = selectable.filter(a => !selectable.some(p => p.id === a.parentId));
  return (
    <ul className="max-h-64 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border-secondary)] p-2" data-testid="area-picker">
      {roots.map(r => render(r, 0))}
      <li className="sr-only">{value.map(v => areaPath(v, areas)).join(', ')}</li>
    </ul>
  );
}
