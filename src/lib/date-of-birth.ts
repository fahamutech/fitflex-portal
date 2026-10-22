// Date of birth: the same rule the backend applies on POST /admin/members
// (fitflex-functions src/shared/date-of-birth.mjs). Strict "YYYY-MM-DD", a real
// calendar date, from 1901-01-01 up to today in Dar es Salaam (UTC+3, no DST).
// '' (or only spaces) clears it. Anything else is refused with
// 400 { error: 'invalid_field', field: 'dateOfBirth' }.

export const DOB_MIN = '1901-01-01';
const EAT_OFFSET_MS = 3 * 3_600_000; // Africa/Dar_es_Salaam
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today's Dar es Salaam day, "YYYY-MM-DD". */
export const dobMax = (now: Date = new Date()): string =>
  new Date(now.getTime() + EAT_OFFSET_MS).toISOString().slice(0, 10);

export const isAbsentDateOfBirth = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

export type DobProblem = 'invalid' | 'future';

/** null when the value may be sent (valid or blank), else why the server would refuse it. */
export function dateOfBirthProblem(value: unknown, now: Date = new Date()): DobProblem | null {
  if (isAbsentDateOfBirth(value)) return null;
  if (typeof value !== 'string') return 'invalid';
  const m = DAY_RE.exec(value);
  if (!m) return 'invalid';
  const [y, mo, d] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return 'invalid';
  if (value < DOB_MIN) return 'invalid';
  if (value > dobMax(now)) return 'future';
  return null;
}

/** True when the server refused the date of birth: 400 { error: 'invalid_field', field: 'dateOfBirth' }. */
export function isDateOfBirthRefusal(e: unknown): boolean {
  const err = e as { status?: number; body?: { error?: string; field?: string } | null } | null;
  return err?.status === 400 && err.body?.error === 'invalid_field' && err.body?.field === 'dateOfBirth';
}
