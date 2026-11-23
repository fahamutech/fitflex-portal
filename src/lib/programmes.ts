// Programmes P1 (slice PO1): staff author FitFlex programmes — fixed-length, day-by-day plans.
// Backend: fitflex-functions docs/programmes-api.md (admin routes, `exercises` scope, PD-7).
// Authoring works while the member flag PROGRAMMES_CATALOGUE is off; `catalogueOn` says whether members see them.
import { request } from './api';

export type ProgrammeStatus = 'draft' | 'live' | 'retired';
export type ProgrammeDayType = 'gym' | 'home' | 'rest';

export interface ProgrammeExercise {
  exerciseName: string;
  libraryId?: string;
  sets: number;
  reps?: number | null;
  duration?: number | null;
  tracksWeight?: boolean;
}
export interface ProgrammeWorkout {
  name: string;
  activityType: string;
  estimatedDuration?: number | null;
  exercises: ProgrammeExercise[];
}
export interface ProgrammeDay { day: number; type: ProgrammeDayType; workout?: ProgrammeWorkout | null }

export interface ProgrammeInput {
  title: string;
  summary?: string | null;
  i18n?: { sw?: { title?: string; summary?: string } } | null;
  goal: string;
  level: string;
  environment: string;
  equipment: string[];
  lengthDays: number;
  days: ProgrammeDay[];
}
export interface Programme extends ProgrammeInput {
  id: string;
  status: ProgrammeStatus;
  versionOf?: string | null;
  enrolled?: number;
  publishedAt?: string | null;
  retiredAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

// The backend's fixed vocabulary (fitflex-functions src/shared/training-taxonomy.mjs, workout-service.mjs).
export const PROGRAMME_GOALS = ['lose_weight', 'gain_muscle', 'build_muscle', 'stay_fit', 'improve_endurance', 'improve_flexibility', 'learn_new_skill', 'stress_relief'];
export const PROGRAMME_LEVELS = ['beginner', 'intermediate', 'advanced'];
export const PROGRAMME_ENVIRONMENTS = ['gym', 'home', 'outdoor', 'any'];
export const PROGRAMME_EQUIPMENT = ['none', 'dumbbells', 'resistance_bands', 'free_weights', 'machines', 'full_gym', 'other'];
export const WORKOUT_ACTIVITY_TYPES = ['strength', 'hiit', 'functional', 'mobility', 'stretching', 'sports', 'other'];
export const PROGRAMME_LENGTH = { min: 7, max: 84 };
export const MAX_WORKOUT_EXERCISES = 20;
export const MAX_SETS = 10;

const path = (id: string, tail = '') => `/admin/programmes/${encodeURIComponent(id)}${tail}`;

export const programmesApi = {
  list: (token: string) => request<{ programmes: Programme[]; catalogueOn: boolean }>('/admin/programmes', {}, token),
  get: (token: string, id: string) => request<{ programme: Programme; catalogueOn: boolean }>(path(id), {}, token),
  create: (token: string, body: ProgrammeInput) =>
    request<{ programme: Programme }>('/admin/programmes', { method: 'POST', body: JSON.stringify(body) }, token),
  update: (token: string, id: string, body: Partial<ProgrammeInput>) =>
    request<{ programme: Programme }>(path(id), { method: 'PUT', body: JSON.stringify(body) }, token),
  publish: (token: string, id: string) => request<{ programme: Programme }>(path(id, '/publish'), { method: 'POST' }, token),
  retire: (token: string, id: string) => request<{ programme: Programme }>(path(id, '/retire'), { method: 'POST' }, token),
  duplicate: (token: string, id: string) => request<{ programme: Programme }>(path(id, '/duplicate'), { method: 'POST' }, token),
};

/** A blank grid: every day a rest day until staff choose otherwise. */
export function blankDays(lengthDays: number, prior: ProgrammeDay[] = []): ProgrammeDay[] {
  return Array.from({ length: lengthDays }, (_, i) => prior[i] ? { ...prior[i], day: i + 1 } : { day: i + 1, type: 'rest' as const });
}

/** What the editor warns about or blocks on, before the server is asked (the server checks again). */
export interface ProgrammeCheck { blocking: { key: string; day?: number }[]; warnings: { key: string; day?: number }[] }
export function checkProgramme(p: ProgrammeInput): ProgrammeCheck {
  const blocking: ProgrammeCheck['blocking'] = [];
  const warnings: ProgrammeCheck['warnings'] = [];
  if (!p.title.trim()) blocking.push({ key: 'prog.check.title' });
  if (!p.summary?.trim()) blocking.push({ key: 'prog.check.summary' });
  if (!p.i18n?.sw?.title?.trim() || !p.i18n?.sw?.summary?.trim()) blocking.push({ key: 'prog.check.swahili' });
  if (!p.days.some(d => d.type !== 'rest')) blocking.push({ key: 'prog.check.noTraining' });
  for (const d of p.days) if (d.type === 'home' && !d.workout) blocking.push({ key: 'prog.check.homeWorkout', day: d.day });
  let run = 0;
  for (const d of p.days) {
    run = d.type === 'rest' ? run + 1 : 0;
    if (run === 4) warnings.push({ key: 'prog.check.restRun', day: d.day });
  }
  return { blocking, warnings };
}
