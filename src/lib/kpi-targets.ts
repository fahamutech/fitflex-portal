// FR-K01: KPI targets for Programmes & Nutrition and the WhatsApp funnel.
// Backend: fitflex-functions docs/kpi-targets-api.md (admin, `analytics` scope; every change audited).
import { request } from './api';

export type KpiUnit = 'percent' | 'percent_change' | 'percent_lower' | 'points' | 'count';
export interface KpiTarget {
  id: string;
  area: 'programmes' | 'whatsapp';
  sort: number;
  unit: KpiUnit;
  baseline: string | null;
  draftTarget: number | null;
  target: number;
  assumption: boolean;
  confirmedAt: string | null;
  confirmedBy: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}
export interface KpiTargetPatch { target?: number; baseline?: string | null; confirmed?: boolean }

/** The backend's range per unit (kpi-target-service.mjs). */
export const KPI_RANGE: Record<KpiUnit, { min: number; max: number }> = {
  percent: { min: 0, max: 100 },
  percent_lower: { min: 0, max: 100 },
  percent_change: { min: -100, max: 1000 },
  points: { min: -100, max: 100 },
  count: { min: 0, max: 1_000_000 },
};

export const kpiTargetsApi = {
  list: (token: string) => request<{ targets: KpiTarget[] }>('/admin/kpi-targets', {}, token),
  update: (token: string, id: string, body: KpiTargetPatch) =>
    request<{ target: KpiTarget }>(`/admin/kpi-targets/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }, token),
};
