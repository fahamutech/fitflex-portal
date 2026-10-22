// Vendor "Based in" / "Delivers to" mapping for admins (docs/shop-near-you-api.md in fitflex-functions).
// An area covers everything beneath it: the country = nationwide, a region covers its cities and districts,
// a city covers its districts.
import type { GeoArea, VendorSummary } from './api';

export type VendorProfile = NonNullable<VendorSummary['vendorProfile']>;

export function indexAreas(areas: GeoArea[]): Map<string, GeoArea> {
  return new Map(areas.map(a => [a.id, a]));
}

/** Ancestors of an area, nearest first (parent, grandparent, …). */
export function ancestors(id: string, byId: Map<string, GeoArea>): GeoArea[] {
  const out: GeoArea[] = [];
  const seen = new Set<string>([id]);
  let cur = byId.get(id);
  while (cur?.parentId && !seen.has(cur.parentId)) {
    seen.add(cur.parentId);
    const parent = byId.get(cur.parentId);
    if (!parent) break;
    out.push(parent);
    cur = parent;
  }
  return out;
}

/** Show each area's name in the reader's language: `names[lang]` (/shop/areas) or `nameSw` (/admin/geo-areas rows), else `name`. */
export function localiseAreas(areas: GeoArea[], locale: 'en' | 'sw'): GeoArea[] {
  return areas.map(a => ({ ...a, name: a.names?.[locale]?.trim() || (locale === 'sw' ? a.nameSw?.trim() : '') || a.name }));
}

/** Usable = this area and every ancestor active (rows from /shop/areas carry no `active`, they are all usable). */
export function usableAreas(areas: GeoArea[]): GeoArea[] {
  const byId = indexAreas(areas);
  return areas.filter(a => a.active !== false && ancestors(a.id, byId).every(p => p.active !== false));
}

/** The picked area above `id` that already covers it, if any (nearest first). */
export function coveringArea(id: string, picked: string[], byId: Map<string, GeoArea>): GeoArea | undefined {
  return ancestors(id, byId).find(p => picked.includes(p.id));
}

/** The region an area sits in (itself when it is a region). */
export function regionOf(id: string, byId: Map<string, GeoArea>): string | null {
  const a = byId.get(id);
  if (!a) return null;
  if (a.level === 'region') return a.id;
  return ancestors(id, byId).find(p => p.level === 'region')?.id ?? null;
}

/** "Kinondoni, Dar es Salaam" (area then its city/region; the country is left out). Unknown ids show as-is. */
export function areaLabel(id: string, byId: Map<string, GeoArea>): string {
  const a = byId.get(id);
  if (!a) return id;
  const parent = ancestors(id, byId).find(p => p.level !== 'country' && p.name !== a.name);
  return parent && a.level !== 'region' ? `${a.name}, ${parent.name}` : a.name;
}

export function hasBasedIn(p: VendorProfile | null | undefined): boolean {
  return !!(p?.cityId || p?.regionId);
}

export function deliveryIds(p: VendorProfile | null | undefined): string[] {
  return Array.isArray(p?.deliveryAreaIds) ? p!.deliveryAreaIds! : [];
}

/** Not in near-you at all: no "Based in" and no "Delivers to". */
export function hasNoArea(p: VendorProfile | null | undefined): boolean {
  return !hasBasedIn(p) && deliveryIds(p).length === 0;
}

/** The vendor's free-text delivery regions as a list (stored as a list or comma text). */
export function freeTextRegions(p: VendorProfile | null | undefined): string[] {
  const raw = p?.deliveryRegions;
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  return list.map(s => String(s).trim()).filter(Boolean);
}

/** Free-text entries that exactly name an area (case-insensitive), as the backfill does. */
export function suggestAreas(texts: string[], areas: GeoArea[]): GeoArea[] {
  const order: GeoArea['level'][] = ['region', 'city', 'district'];
  const found = new Map<string, GeoArea>();
  for (const text of texts) {
    const q = text.toLowerCase();
    if (['tanzania', 'nationwide', 'all of tanzania', 'tanzania nzima'].includes(q)) {
      const country = areas.find(a => a.level === 'country');
      if (country) found.set(country.id, country);
      continue;
    }
    for (const level of order) {
      const hit = areas.find(a => a.level === level && [a.name, a.names?.en, a.names?.sw, a.nameSw].some(n => n?.toLowerCase() === q));
      if (hit) { found.set(hit.id, hit); break; }
    }
  }
  return [...found.values()];
}

/** Which areas match a search, plus their ancestors so the tree stays readable. */
export function searchVisible(areas: GeoArea[], query: string): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const byId = indexAreas(areas);
  const visible = new Set<string>();
  for (const a of areas) {
    if (!a.name.toLowerCase().includes(q)) continue;
    visible.add(a.id);
    ancestors(a.id, byId).forEach(p => visible.add(p.id));
  }
  return visible;
}
