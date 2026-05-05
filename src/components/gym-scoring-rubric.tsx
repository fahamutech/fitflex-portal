'use client';
import { useState, useMemo, useCallback, useEffect, useRef, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/* ═══════════════════════════════════════════════════════════
   FITFLEX AF — GYM CLASSIFICATION RUBRIC v2.3
   Converted to React + Tailwind + design tokens
   ═══════════════════════════════════════════════════════════ */

// ── Data constants ──────────────────────────────────────────

export const EQUIPMENT_CATEGORIES = [
  { id: 'cardio', label: 'Cardio', items: [
    { name: 'Treadmills', unit: 'unit' }, { name: 'Stationary Bikes', unit: 'unit' }, { name: 'Spin / Cycling Bikes', unit: 'unit' },
    { name: 'Ellipticals', unit: 'unit' }, { name: 'Rowing Machines', unit: 'unit' }, { name: 'Stair Climbers', unit: 'unit' },
  ]},
  { id: 'freeweights', label: 'Free Weights', items: [
    { name: 'Dumbbell Racks', unit: 'station', hint: '1 station = 1 observable rack/stall of dumbbells' },
    { name: 'Barbell + Plate Stations', unit: 'station', hint: '1 station = 1 loaded bar setup (bar + rack + plates)' },
    { name: 'Kettlebell Sets', unit: 'station', hint: '1 station = 1 rack/collection of kettlebells' },
    { name: 'EZ Curl Bars', unit: 'unit' },
  ]},
  { id: 'machines', label: 'Resistance Machines', items: [
    { name: 'Cable Machines', unit: 'unit' }, { name: 'Lat Pulldown', unit: 'unit' }, { name: 'Leg Press', unit: 'unit' },
    { name: 'Chest Press', unit: 'unit' }, { name: 'Smith Machine', unit: 'unit' }, { name: 'Multi-Station / Jungle Gym', unit: 'unit' },
  ]},
  { id: 'functional', label: 'Functional Training', items: [
    { name: 'Pull-up Bars', unit: 'unit' }, { name: 'Squat Racks / Power Racks', unit: 'unit' }, { name: 'Benches (Flat/Incline/Decline)', unit: 'unit' },
    { name: 'Battle Ropes', unit: 'unit' }, { name: 'TRX / Suspension Trainers', unit: 'unit' }, { name: 'Plyo Boxes', unit: 'unit' },
  ]},
  { id: 'specialty', label: 'Specialty', items: [
    { name: 'Olympic Platform', unit: 'unit' }, { name: 'CrossFit Rig', unit: 'unit' }, { name: 'Heavy Bags / Boxing', unit: 'unit' },
    { name: 'Yoga / Pilates Equipment', unit: 'unit' }, { name: 'Stretching Area', unit: 'unit' },
  ]},
];

const CONDITION_LEVELS = [
  { key: 'new', label: 'New-Like', score: 5 },
  { key: 'operational', label: 'Operational', score: 3.5 },
  { key: 'worn', label: 'Worn', score: 2 },
  { key: 'broken', label: 'Broken', score: 0.5 },
];

const WET_AMENITIES = [
  { id: 'pool', label: 'Pool', types: ['Indoor Pool', 'Outdoor Pool', 'Plunge Pool'] },
  { id: 'sauna', label: 'Sauna', types: ['Dry Sauna', 'Steam Room', 'Infrared Sauna'] },
  { id: 'spa', label: 'Spa', types: ['Hot Tub / Jacuzzi', 'Cold Plunge', 'Hydrotherapy'] },
];

const WIFI_LEVELS = [
  { key: 1, label: 'No WiFi available', score: 1.0 },
  { key: 2, label: 'Open WiFi, unreliable/slow', score: 2.5 },
  { key: 3, label: 'Password-protected, moderate speed', score: 3.5 },
  { key: 4, label: 'Reliable WiFi, good for streaming', score: 5.0 },
];

const AMENITY_MANUAL = [
  { id: 'lockers', label: 'Changing / Locker Area', levels: ['None — change in restroom or open area', 'Basic open changing area with hooks', 'Dedicated room with shelves/hooks', 'Individual lockers (key or padlock)', 'Premium lockers with digital codes'] },
  { id: 'showers_quality', label: 'Shower Quality', levels: ['No showers available', 'Cold water only, shared stall', 'Hot & cold water, basic stalls', 'Clean private stalls with hot water', 'Premium stalls with toiletries'] },
  { id: 'climate', label: 'Climate Control', levels: ['None — open air / no ventilation', 'Ceiling or standing fans only', 'Basic AC in main area', 'Full AC with ventilation throughout', 'Climate-controlled zones'] },
  { id: 'towel_extras', label: 'Towel Service & Extras', levels: ['Nothing provided', 'Water dispenser available', 'Towels available for rent', 'Complimentary towels included', 'Full towel service + toiletries + refreshments'] },
];

const FACILITY_CRITERIA = [
  { id: 'size', label: 'Usable Floor Space', levels: ['Under 50 sqm — very cramped', '50–100 sqm — small', '100–250 sqm — adequate, some zones', '250–500 sqm — spacious, defined zones', '500+ sqm — large, distinct areas'] },
  { id: 'cleanliness', label: 'Cleanliness Standard', levels: ['Visibly dirty — dust, debris, odour', 'Basic cleaning, inconsistent', 'Clean — regular schedule', 'Very clean — sanitisation stations visible', 'Immaculate — professionally cleaned'] },
  { id: 'layout', label: 'Layout & Flow', levels: ['Cluttered, disorganised, safety risk', 'Basic arrangement, no clear zones', 'Organised with identifiable areas', 'Well-designed flow, clear zones, good spacing', 'Professionally designed, intuitive, premium finishes'] },
  { id: 'lighting_floor', label: 'Lighting, Mirrors & Flooring', levels: ['Poor lighting, no mirrors, bare floor', 'Basic fluorescent, few mirrors, basic floor', 'Adequate lighting, mirrors in key areas, rubber mats', 'Good lighting, full mirrors, proper gym flooring', 'Professional lighting, wall-to-wall mirrors, premium floor'] },
];

const STAFFING_CRITERIA = [
  { id: 'reception', label: 'Front Desk / Reception', levels: ['No staff — self-service or owner only', 'Part-time, gaps in coverage', 'Staff during all operating hours', 'Full reception + check-in process', 'Concierge-level, always staffed'] },
  { id: 'trainers', label: 'Trainer Availability', levels: ['None available', 'Freelance trainers visit occasionally', '1–2 regular trainers on schedule', '3+ trainers with specialisations', 'Certified team, group classes, tracks'] },
  { id: 'hours', label: 'Operating Hours', levels: ['Under 8 hrs/day', '8–10 hrs/day', '10–14 hrs/day', '14–18 hrs/day', '18+ hrs/day or 24/7'] },
  { id: 'records', label: 'Record Keeping & Systems', levels: ['No records — cash only', 'Paper notebook or ledger', 'Spreadsheet or basic digital', 'Organised digital records, member DB', 'Management software, digital payments'] },
];

export const LOCATION_ZONES = [
  { id: 'premium', label: 'Premium Zone', multiplier: 1.35, areas: 'Masaki, Oyster Bay, Msasani, Ada Estate, CBD/Posta, Upanga' },
  { id: 'upper', label: 'Upper Zone', multiplier: 1.20, areas: 'Mikocheni, Kawe, Regent Estate, Mbezi Beach (front)' },
  { id: 'standard', label: 'Standard Zone', multiplier: 1.05, areas: 'Sinza, Mwenge, Kinondoni, Kijitonyama, Makumbusho, Victoria, Ilala' },
  { id: 'outer', label: 'Outer Zone', multiplier: 0.90, areas: 'Tegeta, Goba, Mbezi Luis, Kigamboni, Kimara, Bunju, Kibamba' },
  { id: 'emerging', label: 'Emerging Zone', multiplier: 0.80, areas: 'Kitunda, Chanika, Mbopo + any location not on main road / no paved road within 3–6km' },
];

const WEIGHTS = { equipment: 0.40, amenities: 0.27, facility: 0.23, staffing: 0.10 };
const BUFFER = 0.15;

const TIER_CONFIG: Record<string, { label: string; range: string; baseMax?: number; baseMin?: number }> = {
  standard: { label: 'Standard', range: '1.00 – 2.00', baseMax: 60000 },
  midrange: { label: 'Mid-Range', range: '2.01 – 3.00', baseMin: 60001, baseMax: 120000 },
  premium: { label: 'Premium', range: '3.01 – 4.00', baseMin: 120001, baseMax: 250000 },
  luxury: { label: 'Luxury / Executive', range: '4.01 – 5.00 + Gate', baseMin: 250001 },
};

// Maps our tier names to the backend tier keys
const TIER_TO_BACKEND: Record<string, string> = {
  standard: 'standard',
  midrange: 'midtier',
  premium: 'premium',
  luxury: 'luxury_executive',
};

function showerRatioScore(c: number, p: number) { if (!c || !p) return 0; const r = p / c; return r <= 5 ? 5 : r <= 8 ? 4 : r <= 12 ? 3 : r <= 18 ? 2 : 1; }
function toiletRatioScore(c: number, p: number) { if (!c || !p) return 0; const r = p / c; return r <= 8 ? 5 : r <= 12 ? 4 : r <= 18 ? 3 : r <= 25 ? 2 : 1; }
function getTier(s: number, g: boolean) { if (s > 4 && g) return 'luxury'; if (s > 4) return 'premium'; if (s > 3) return 'premium'; if (s > 2) return 'midrange'; return 'standard'; }
function getFlags(s: number, g: boolean, m: string[]) {
  const f: string[] = [];
  for (const b of [2, 3, 4]) if (Math.abs(s - b) <= BUFFER) f.push(`Score ${s.toFixed(2)} in buffer zone around ${b.toFixed(1)} — senior review required.`);
  if (s > 3 && s <= 4 && g) f.push('Scores Premium but passes Luxury Gate — review for potential upgrade.');
  if (s > 4 && !g) f.push(`Luxury score but missing gate: ${m.join(', ')}. Capped at Premium.`);
  return f;
}

// ── Sub-components ──────────────────────────────────────────

const scoreColors = ['', 'text-[var(--color-error-600)]', 'text-[var(--color-warning-600)]', 'text-yellow-600', 'text-[var(--color-success-600)]', 'text-[var(--color-brand-600)]'];
const scoreBgs = ['', 'bg-[var(--color-error-50)]', 'bg-[var(--color-warning-50)]', 'bg-yellow-50', 'bg-[var(--color-success-50)]', 'bg-[var(--color-brand-50)]'];

function Section({ title, weight, complete, dimScore, open, onToggle, children }: {
  title: string; weight: number; complete: boolean; dimScore: number; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  const color = dimScore >= 4 ? 'text-[var(--color-brand-600)]' : dimScore >= 3 ? 'text-[var(--color-success-600)]' : dimScore >= 2 ? 'text-yellow-600' : dimScore > 0 ? 'text-[var(--color-error-600)]' : 'text-[var(--color-fg-quaternary)]';
  return (
    <div className="mb-2 rounded-[var(--radius-xl)] border border-[var(--color-border-secondary)] overflow-hidden">
      <button onClick={onToggle} className={cn('w-full px-4 py-3 flex items-center justify-between', open ? 'bg-[var(--color-bg-secondary)]' : 'bg-[var(--color-bg-primary)]')}>
        <div className="text-left">
          <span className="text-sm font-semibold text-[var(--color-fg-primary)]">{title}</span>
          <span className="text-xs text-[var(--color-fg-quaternary)] ml-2">{weight}%</span>
          <div className={cn('text-xs mt-0.5', complete ? 'text-[var(--color-success-600)]' : 'text-[var(--color-fg-quaternary)]')}>
            {complete ? 'Complete' : 'In progress'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dimScore > 0 && <span className={cn('font-mono text-base font-bold tabular-nums', color)}>{dimScore.toFixed(2)}</span>}
          <span className={cn('text-[var(--color-fg-quaternary)] transition-transform', open && 'rotate-180')}>&#9662;</span>
        </div>
      </button>
      {open && <div className="px-4 pb-4 pt-2">{children}</div>}
    </div>
  );
}

function ManualScore({ criterion, value, onChange }: {
  criterion: { label: string; levels: string[] }; value: number; onChange: (v: number) => void;
}) {
  return (
    <div className="mb-4 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)] p-3 border border-[var(--color-border-secondary)]">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs font-semibold text-[var(--color-fg-primary)]">{criterion.label}</span>
        <span className={cn('font-mono text-sm font-bold tabular-nums px-2 py-0.5 rounded-[var(--radius-md)]', value > 0 ? `${scoreColors[value]} ${scoreBgs[value]}` : 'text-[var(--color-fg-quaternary)]')}>
          {value || '—'}
        </span>
      </div>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} onClick={() => onChange(value === n ? 0 : n)} className={cn(
            'flex-1 h-8 rounded-[var(--radius-md)] font-mono text-sm font-bold border-2 transition-colors',
            value === n ? `${scoreColors[n]} border-current ${scoreBgs[n]}` : 'text-[var(--color-fg-quaternary)] border-[var(--color-border-secondary)] hover:border-[var(--color-border-primary)]'
          )}>{n}</button>
        ))}
      </div>
      {value > 0 && <p className="text-xs text-[var(--color-fg-tertiary)] mt-1.5 italic">{criterion.levels[value - 1]}</p>}
    </div>
  );
}

function ConditionPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const items = CONDITION_LEVELS;
  return (
    <div className="flex gap-1">
      {items.map(cl => (
        <button key={cl.key} onClick={() => onChange(value === cl.key ? '' : cl.key)} className={cn(
          'flex-1 px-1 py-1.5 rounded-[var(--radius-md)] text-[10px] font-semibold border transition-colors',
          value === cl.key
            ? cl.score >= 4 ? 'text-[var(--color-brand-600)] border-[var(--color-brand-300)] bg-[var(--color-brand-50)]'
              : cl.score >= 3 ? 'text-[var(--color-success-600)] border-[var(--color-success-300)] bg-[var(--color-success-50)]'
              : cl.score >= 2 ? 'text-[var(--color-warning-600)] border-[var(--color-warning-300)] bg-[var(--color-warning-50)]'
              : 'text-[var(--color-error-600)] border-[var(--color-error-300)] bg-[var(--color-error-50)]'
            : 'text-[var(--color-fg-quaternary)] border-[var(--color-border-secondary)]'
        )}>{cl.label}</button>
      ))}
    </div>
  );
}

// ── Types ──────────────────────────────────────────────────
export interface RubricData {
  equipInv: Record<string, { present: boolean; qty: number; condition: string; brand: string }>;
  wetInv: Record<string, { present: boolean; qty: number; condition: string }>;
  manualScores: Record<string, number>;
  wifiLevel: number;
  showerCt: string;
  toiletCt: string;
  toiletCond: string;
  peakCap: string;
  locZone: string;
}

export interface RubricResult {
  tier: string;
  backendTier: string;
  finalScore: number;
  flags: string[];
  luxuryGatePassed: boolean;
}

export const EMPTY_RUBRIC: RubricData = {
  equipInv: {}, wetInv: {}, manualScores: {},
  wifiLevel: 0, showerCt: '', toiletCt: '', toiletCond: '',
  peakCap: '', locZone: '',
};

// ── Main Component ─────────────────────────────────────────

export function GymScoringRubric({ data, onChange, onResult }: {
  data: RubricData;
  onChange: (d: RubricData) => void;
  onResult?: (r: RubricResult) => void;
}) {
  const [openSec, setOpenSec] = useState<string | null>('equipment');

  const { equipInv, wetInv, manualScores: ms, wifiLevel, showerCt, toiletCt, toiletCond, peakCap, locZone } = data;
  const peak = parseInt(peakCap) || 0;
  const zone = LOCATION_ZONES.find(z => z.id === locZone);

  const setEq = useCallback((item: string, field: string, value: unknown) => {
    const prev = data.equipInv[item] || { present: false, qty: 0, condition: '', brand: '' };
    onChange({ ...data, equipInv: { ...data.equipInv, [item]: { ...prev, [field]: value } } });
  }, [data, onChange]);

  const setWet = useCallback((item: string, field: string, value: unknown) => {
    const prev = data.wetInv[item] || { present: false, qty: 0, condition: '' };
    onChange({ ...data, wetInv: { ...data.wetInv, [item]: { ...prev, [field]: value } } });
  }, [data, onChange]);

  const setManual = useCallback((id: string, v: number) => {
    onChange({ ...data, manualScores: { ...data.manualScores, [id]: v } });
  }, [data, onChange]);

  const results = useMemo(() => {
    // Equipment
    const pItems = Object.entries(equipInv).filter(([, v]) => v.present && v.qty > 0);
    const tQty = pItems.reduce((s, [, v]) => s + (v.qty || 0), 0);
    const cats = new Set<string>();
    for (const [n] of pItems) for (const c of EQUIPMENT_CATEGORIES) { if (c.items.some(i => i.name === n)) { cats.add(c.id); break; } }
    const qS = tQty >= 30 ? 5 : tQty >= 22 ? 4 : tQty >= 15 ? 3 : tQty >= 8 ? 2 : tQty > 0 ? 1 : 0;
    const vS = Math.min(5, cats.size);
    const cndS = pItems.map(([, v]) => { const c = CONDITION_LEVELS.find(x => x.key === v.condition); return c ? c.score : 0; }).filter(s => s > 0);
    const avgC = cndS.length > 0 ? cndS.reduce((a, b) => a + b, 0) / cndS.length : 0;
    const eqScore = pItems.length > 0 ? (qS + vS + avgC) / 3 : 0;
    const eqDone = pItems.length > 0 && pItems.every(([, v]) => !!v.condition);

    // Amenities (7 sub-scores)
    const lockS = ms.lockers || 0;
    const shwQ = ms.showers_quality || 0;
    const sc = parseInt(showerCt) || 0;
    const shwR = showerRatioScore(sc, peak);
    const shwB = (shwQ > 0 && shwR > 0) ? (shwQ + shwR) / 2 : shwQ || 0;
    const tCond = CONDITION_LEVELS.find(c => c.key === toiletCond);
    const tCS = tCond ? tCond.score : 0;
    const tc = parseInt(toiletCt) || 0;
    const tR = toiletRatioScore(tc, peak);
    const tB = (tCS > 0 && tR > 0) ? (tCS + tR) / 2 : tCS || 0;
    const climS = ms.climate || 0;
    const towS = ms.towel_extras || 0;
    const wifiS = wifiLevel > 0 ? (WIFI_LEVELS.find(w => w.key === wifiLevel)?.score || 0) : 0;

    const wetP = Object.entries(wetInv).filter(([, v]) => v.present && v.qty > 0);
    const wetT = new Set<string>();
    for (const [n] of wetP) for (const w of WET_AMENITIES) { if (w.types.includes(n)) { wetT.add(w.id); break; } }
    const wetCS = wetP.map(([, v]) => { const c = CONDITION_LEVELS.find(x => x.key === v.condition); return c ? c.score : 0; }).filter(s => s > 0);
    const avgWC = wetCS.length > 0 ? wetCS.reduce((a, b) => a + b, 0) / wetCS.length : 0;
    let wetS = 0;
    if (wetP.length === 0) wetS = 0;
    else if (wetT.size === 1 && avgWC < 3) wetS = 2;
    else if (wetT.size === 1) wetS = 3;
    else if (wetT.size === 2) wetS = 4;
    else if (wetT.size >= 3) wetS = 5;
    else wetS = 1;

    const amSubs = [lockS, shwB, tB, climS, towS, wifiS, wetS];
    const amDim = amSubs.reduce((a, b) => a + b, 0) / 7;
    const amDone = lockS > 0 && shwQ > 0 && sc > 0 && tCS > 0 && tc > 0 && climS > 0 && towS > 0 && wifiLevel > 0;

    // Facility
    const fS = FACILITY_CRITERIA.map(c => ms[c.id] || 0).filter(s => s > 0);
    const fDim = fS.length > 0 ? fS.reduce((a, b) => a + b, 0) / FACILITY_CRITERIA.length : 0;
    const fDone = fS.length === FACILITY_CRITERIA.length;

    // Staffing
    const sS = STAFFING_CRITERIA.map(c => ms[c.id] || 0).filter(s => s > 0);
    const sDim = sS.length > 0 ? sS.reduce((a, b) => a + b, 0) / STAFFING_CRITERIA.length : 0;
    const sDone = sS.length === STAFFING_CRITERIA.length;

    // Composite
    const dims = { equipment: eqScore, amenities: amDim, facility: fDim, staffing: sDim };
    let base = 0;
    for (const [k, w] of Object.entries(WEIGHTS)) base += dims[k as keyof typeof dims] * w;
    const final = Math.max(1, Math.min(5, base));

    // Luxury gate
    const hasPool = wetP.some(([n, v]) => WET_AMENITIES[0].types.includes(n) && v.condition && v.condition !== 'broken');
    const hasSauna = wetP.some(([n, v]) => WET_AMENITIES[1].types.includes(n) && v.condition && v.condition !== 'broken');
    const hasTowel = (ms.towel_extras || 0) >= 4;
    const gI = [{ label: 'Pool', passed: hasPool }, { label: 'Spa or Sauna', passed: hasSauna }, { label: 'Towel Service (>= 4)', passed: hasTowel }];
    const gP = gI.every(g => g.passed);
    const gM = gI.filter(g => !g.passed).map(g => g.label);
    const tier = getTier(final, gP);
    const flags = getFlags(final, gP, gM);

    return { dims, eqScore, amDim, fDim, sDim, base, final, tier, flags, gP, gI, gM, eqDone, amDone, fDone, sDone, tQty, cats: cats.size, avgC, qS, vS, shwB, amSubs };
  }, [equipInv, wetInv, ms, showerCt, toiletCt, toiletCond, peak, wifiLevel]);

  // Notify parent of result (via useEffect to avoid side effects in render)
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  useEffect(() => {
    if (onResultRef.current && results.base > 0) {
      onResultRef.current({
        tier: results.tier,
        backendTier: TIER_TO_BACKEND[results.tier] || 'standard',
        finalScore: results.final,
        flags: results.flags,
        luxuryGatePassed: results.gP,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.tier, results.final, results.gP]);

  const tc = TIER_CONFIG[results.tier];
  const any = results.base > 0;

  return (
    <div className="space-y-4">
      {/* Peak capacity */}
      <div className="rounded-[var(--radius-lg)] bg-[var(--color-warning-50)] border border-[var(--color-warning-200)] p-3">
        <label className="text-xs font-semibold text-[var(--color-warning-800)] block mb-1">Est. Peak-Hour Members <span className="font-normal">(required for ratio scoring)</span></label>
        <input
          type="number"
          value={peakCap}
          onChange={e => onChange({ ...data, peakCap: e.target.value })}
          placeholder="e.g. 30"
          className="ui-input w-24 font-mono font-bold"
        />
      </div>

      {/* Location Zone */}
      <div className="rounded-[var(--radius-lg)] bg-[var(--color-success-50)] border border-[var(--color-success-200)] p-3">
        <label className="text-xs font-semibold text-[var(--color-success-800)] block mb-2">Location Zone <span className="font-normal">(adjusts price validation)</span></label>
        <div className="flex flex-wrap gap-1.5">
          {LOCATION_ZONES.map(z => (
            <button key={z.id} onClick={() => onChange({ ...data, locZone: locZone === z.id ? '' : z.id })} className={cn(
              'px-2.5 py-1.5 rounded-[var(--radius-md)] border text-xs font-medium transition-colors',
              locZone === z.id
                ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)] border-[var(--color-brand-300)]'
                : 'text-[var(--color-fg-quaternary)] border-[var(--color-border-secondary)] hover:bg-[var(--color-bg-tertiary)]'
            )}>
              {z.label} <span className="font-mono text-[10px]">{z.multiplier}x</span>
            </button>
          ))}
        </div>
        {zone && <p className="text-xs text-[var(--color-success-700)] mt-2"><strong>{zone.label}:</strong> {zone.areas}</p>}
      </div>

      {/* Weight indicators */}
      <div className="flex gap-1">
        {[{ l: 'Equipment', w: 40 }, { l: 'Amenities', w: 27 }, { l: 'Facility', w: 23 }, { l: 'Staffing', w: 10 }].map(d => (
          <div key={d.l} className="flex-1 rounded-[var(--radius-md)] bg-[var(--color-bg-tertiary)] py-1.5 text-center" style={{ flex: d.w }}>
            <div className="font-mono text-xs font-bold text-[var(--color-brand-600)]">{d.w}%</div>
            <div className="text-[10px] text-[var(--color-fg-quaternary)]">{d.l}</div>
          </div>
        ))}
      </div>

      {/* Equipment */}
      <Section title="Equipment Inventory" weight={40} open={openSec === 'equipment'} onToggle={() => setOpenSec(openSec === 'equipment' ? null : 'equipment')} complete={results.eqDone} dimScore={results.eqScore}>
        {EQUIPMENT_CATEGORIES.map(cat => (
          <div key={cat.id} className="mb-4">
            <h4 className="text-sm font-semibold text-[var(--color-fg-primary)] mb-2">{cat.label}</h4>
            {cat.items.map(item => {
              const d = equipInv[item.name] || { present: false, qty: 0, condition: '', brand: '' };
              const isStn = item.unit === 'station';
              return (
                <div key={item.name} className={cn('mb-1.5 p-2.5 rounded-[var(--radius-lg)] border transition-colors', d.present ? 'border-[var(--color-brand-200)] bg-[var(--color-brand-25,var(--color-bg-secondary))]' : 'border-[var(--color-border-secondary)]')}>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEq(item.name, 'present', !d.present)} className={cn('shrink-0 w-5 h-5 rounded-[var(--radius-sm)] border-2 flex items-center justify-center text-xs text-white', d.present ? 'bg-[var(--color-brand-600)] border-[var(--color-brand-600)]' : 'border-[var(--color-border-primary)]')}>
                      {d.present ? '✓' : ''}
                    </button>
                    <span className={cn('flex-1 text-xs', d.present ? 'font-medium text-[var(--color-fg-primary)]' : 'text-[var(--color-fg-quaternary)]')}>{item.name}</span>
                    {isStn && <span className="text-[9px] font-semibold text-[var(--color-brand-600)]">STATION</span>}
                    {d.present && (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-[var(--color-fg-quaternary)]">{isStn ? 'Stns:' : 'Qty:'}</span>
                        <input type="number" min="0" max="99" value={d.qty === 0 ? '' : d.qty} placeholder="0"
                          onChange={e => setEq(item.name, 'qty', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                          onClick={e => e.stopPropagation()}
                          className="w-11 px-1.5 py-1 rounded-[var(--radius-sm)] border border-[var(--color-border-secondary)] font-mono text-xs text-center" />
                      </div>
                    )}
                  </div>
                  {d.present && item.hint && <p className="text-[10px] text-[var(--color-brand-600)] italic mt-1 pl-7">{item.hint}</p>}
                  {d.present && (
                    <div className="mt-2 space-y-1.5">
                      <ConditionPicker value={d.condition} onChange={v => setEq(item.name, 'condition', v)} />
                      <input value={d.brand || ''} placeholder="Brand (optional)" onChange={e => setEq(item.name, 'brand', e.target.value)}
                        className="w-full px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--color-border-secondary)] text-xs text-[var(--color-fg-tertiary)]" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </Section>

      {/* Amenities */}
      <Section title="Amenities" weight={27} open={openSec === 'amenities'} onToggle={() => setOpenSec(openSec === 'amenities' ? null : 'amenities')} complete={results.amDone} dimScore={results.amDim}>
        <ManualScore criterion={AMENITY_MANUAL[0]} value={ms.lockers || 0} onChange={v => setManual('lockers', v)} />
        <ManualScore criterion={AMENITY_MANUAL[1]} value={ms.showers_quality || 0} onChange={v => setManual('showers_quality', v)} />
        <div className="flex items-center gap-2 mb-4">
          <label className="text-xs font-semibold">Shower stall count:</label>
          <input type="number" min="0" max="50" value={showerCt} placeholder="0"
            onChange={e => onChange({ ...data, showerCt: e.target.value })}
            className="w-14 px-2 py-1.5 rounded-[var(--radius-md)] border border-[var(--color-border-secondary)] font-mono text-sm text-center" />
        </div>

        <div className="rounded-[var(--radius-lg)] bg-[var(--color-warning-50)] border border-[var(--color-warning-200)] p-3 mb-4">
          <h5 className="text-xs font-semibold text-[var(--color-warning-800)] mb-2">Toilets — Condition x Quantity</h5>
          <div className="flex items-center gap-2 mb-2">
            <label className="text-xs font-medium">Count:</label>
            <input type="number" min="0" max="50" value={toiletCt} placeholder="0"
              onChange={e => onChange({ ...data, toiletCt: e.target.value })}
              className="w-14 px-2 py-1.5 rounded-[var(--radius-md)] border border-[var(--color-border-secondary)] font-mono text-sm text-center" />
          </div>
          <label className="text-xs font-medium block mb-1">Condition:</label>
          <ConditionPicker value={toiletCond} onChange={v => onChange({ ...data, toiletCond: v })} />
        </div>

        <ManualScore criterion={AMENITY_MANUAL[2]} value={ms.climate || 0} onChange={v => setManual('climate', v)} />
        <ManualScore criterion={AMENITY_MANUAL[3]} value={ms.towel_extras || 0} onChange={v => setManual('towel_extras', v)} />

        {/* WiFi */}
        <div className="rounded-[var(--radius-lg)] bg-[var(--color-bg-tertiary)] border border-[var(--color-border-secondary)] p-3 mb-4">
          <h5 className="text-xs font-semibold text-[var(--color-fg-primary)] mb-2">WiFi Connectivity</h5>
          <div className="flex gap-1">
            {WIFI_LEVELS.map(w => (
              <button key={w.key} onClick={() => onChange({ ...data, wifiLevel: wifiLevel === w.key ? 0 : w.key })} className={cn(
                'flex-1 py-2 rounded-[var(--radius-md)] border font-mono text-sm font-bold text-center transition-colors',
                wifiLevel === w.key ? 'text-[var(--color-brand-600)] border-[var(--color-brand-300)] bg-[var(--color-brand-50)]' : 'text-[var(--color-fg-quaternary)] border-[var(--color-border-secondary)]'
              )}>{w.key}</button>
            ))}
          </div>
          {wifiLevel > 0 && <p className="text-xs text-[var(--color-fg-tertiary)] mt-1.5 italic">{WIFI_LEVELS.find(w => w.key === wifiLevel)?.label}</p>}
        </div>

        {/* Wet Amenities */}
        <div className="rounded-[var(--radius-lg)] bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] p-3">
          <h5 className="text-sm font-semibold text-[var(--color-brand-700)] mb-2">Wet Amenities</h5>
          {WET_AMENITIES.map(wa => (
            <div key={wa.id} className="mb-3">
              <h6 className="text-xs font-semibold text-[var(--color-brand-700)] mb-1.5">{wa.label}</h6>
              {wa.types.map(tn => {
                const d = wetInv[tn] || { present: false, qty: 0, condition: '' };
                return (
                  <div key={tn} className={cn('mb-1 p-2 rounded-[var(--radius-md)] border', d.present ? 'border-[var(--color-brand-200)]' : 'border-[var(--color-border-secondary)] bg-[var(--color-bg-secondary)]')}>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setWet(tn, 'present', !d.present)} className={cn('shrink-0 w-5 h-5 rounded-[var(--radius-sm)] border-2 flex items-center justify-center text-xs text-white', d.present ? 'bg-[var(--color-brand-600)] border-[var(--color-brand-600)]' : 'border-[var(--color-border-primary)]')}>
                        {d.present ? '✓' : ''}
                      </button>
                      <span className={cn('flex-1 text-xs', d.present ? 'font-medium' : 'text-[var(--color-fg-quaternary)]')}>{tn}</span>
                      {d.present && (
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-[var(--color-fg-quaternary)]">Qty:</span>
                          <input type="number" min="0" max="20" value={d.qty === 0 ? '' : d.qty} placeholder="0"
                            onChange={e => setWet(tn, 'qty', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                            onClick={e => e.stopPropagation()}
                            className="w-11 px-1.5 py-1 rounded-[var(--radius-sm)] border border-[var(--color-border-secondary)] font-mono text-xs text-center" />
                        </div>
                      )}
                    </div>
                    {d.present && <div className="mt-1.5"><ConditionPicker value={d.condition} onChange={v => setWet(tn, 'condition', v)} /></div>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </Section>

      {/* Facility */}
      <Section title="Facility Quality" weight={23} open={openSec === 'facility'} onToggle={() => setOpenSec(openSec === 'facility' ? null : 'facility')} complete={results.fDone} dimScore={results.fDim}>
        {FACILITY_CRITERIA.map(c => <ManualScore key={c.id} criterion={c} value={ms[c.id] || 0} onChange={v => setManual(c.id, v)} />)}
      </Section>

      {/* Staffing */}
      <Section title="Staffing & Operations" weight={10} open={openSec === 'staffing'} onToggle={() => setOpenSec(openSec === 'staffing' ? null : 'staffing')} complete={results.sDone} dimScore={results.sDim}>
        {STAFFING_CRITERIA.map(c => <ManualScore key={c.id} criterion={c} value={ms[c.id] || 0} onChange={v => setManual(c.id, v)} />)}
      </Section>

      {/* Luxury Gate */}
      <div className="rounded-[var(--radius-xl)] bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] p-4">
        <h3 className="text-sm font-semibold text-[var(--color-brand-700)] mb-2">Luxury / Executive Gate</h3>
        <p className="text-xs text-[var(--color-fg-quaternary)] mb-3">ALL three required for Luxury classification.</p>
        {results.gI.map(g => (
          <div key={g.label} className="flex items-center gap-2 mb-1.5">
            <span className={cn('w-5 h-5 rounded-full flex items-center justify-center text-xs', g.passed ? 'bg-[var(--color-success-100)] text-[var(--color-success-700)]' : 'bg-[var(--color-bg-tertiary)] text-[var(--color-fg-quaternary)]')}>
              {g.passed ? '✓' : '–'}
            </span>
            <span className={cn('text-xs', g.passed ? 'font-medium text-[var(--color-success-700)]' : 'text-[var(--color-fg-quaternary)]')}>{g.label}</span>
          </div>
        ))}
      </div>

      {/* Result */}
      {any && tc && (
        <div className="rounded-[var(--radius-xl)] border-2 border-[var(--color-brand-200)] bg-[var(--color-bg-secondary)] p-5">
          <div className="text-center mb-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-fg-quaternary)]">
              {results.eqDone && results.amDone && results.fDone && results.sDone ? 'Classification Result' : 'Projected Result'}
            </p>
            <p className="text-2xl font-bold text-[var(--color-brand-700)] mt-1">{tc.label}</p>
            <p className="text-sm font-mono font-bold tabular-nums text-[var(--color-brand-600)] mt-0.5">{results.final.toFixed(2)} / 5.00</p>
            {zone && <p className="text-xs text-[var(--color-fg-quaternary)] mt-0.5">{zone.label} ({zone.multiplier}x)</p>}
          </div>

          <div className="space-y-1 bg-[var(--color-bg-primary)] rounded-[var(--radius-lg)] p-3 mb-3">
            {[{ l: 'Equipment', w: 40, s: results.eqScore }, { l: 'Amenities', w: 27, s: results.amDim }, { l: 'Facility', w: 23, s: results.fDim }, { l: 'Staffing', w: 10, s: results.sDim }].map(d => (
              <div key={d.l} className="flex justify-between text-xs text-[var(--color-fg-tertiary)]">
                <span>{d.l} ({d.w}%)</span>
                <span className="font-mono tabular-nums">{d.s > 0 ? d.s.toFixed(2) : '—'} x {(d.w / 100).toFixed(2)} = {d.s > 0 ? (d.s * d.w / 100).toFixed(2) : '—'}</span>
              </div>
            ))}
          </div>

          {results.flags.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {results.flags.map((f, i) => (
                <div key={i} className="text-xs text-[var(--color-warning-700)] bg-[var(--color-warning-50)] rounded-[var(--radius-md)] px-3 py-2">{f}</div>
              ))}
            </div>
          )}

          <div className="bg-[var(--color-bg-primary)] rounded-[var(--radius-lg)] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-fg-quaternary)] mb-2">Tier Thresholds</p>
            {Object.entries(TIER_CONFIG).map(([k, c]) => (
              <div key={k} className="flex items-center gap-2 mb-0.5">
                <div className={cn('w-2 h-2 rounded-sm', results.tier === k ? 'bg-[var(--color-brand-600)]' : 'bg-[var(--color-fg-quaternary)]')} />
                <span className={cn('flex-1 text-xs', results.tier === k ? 'font-bold text-[var(--color-fg-primary)]' : 'text-[var(--color-fg-quaternary)]')}>{c.label}</span>
                <span className="font-mono text-[10px] text-[var(--color-fg-quaternary)]">{c.range}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
