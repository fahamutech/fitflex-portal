// Vendor business tools · S8 — barcode rules (docs/design/vendor-barcodes-s8.md §1). Pure functions.
// The same rules run on the server (fitflex-functions src/shared/vendor-barcode.mjs) and in the app
// (lib/screens/vendor/barcodes/barcode_rules.dart). tests/e2e/fixtures/barcode-vectors.json is a copy of the server's
// specs/fixtures/barcode-vectors.json and tests/e2e/vendor-barcodes.spec.ts checks every vector against this file.
//
// B-1 a code is 4–48 printable ASCII characters (0x21–0x7E) after trimming: no spaces, no control characters.
// B-2 codeKey: all digits, 12 long (UPC-A) → '0' + code; all digits, 14 long starting with 0 → drop that 0;
//     other all-digit codes unchanged (8 digits are never expanded); anything with a letter or symbol → upper case.
// B-3 all-digit codes 12, 13 or 14 long must pass the GTIN mod-10 check. 8-digit codes are not checked.
// B-5 at most 20 codes per product (all variants included).
import type { VendorProduct } from './api';

export const BARCODE_MIN = 4;
export const BARCODE_MAX = 48;
export const MAX_BARCODES_PER_PRODUCT = 20;

const PRINTABLE = /^[\x21-\x7E]+$/;
const DIGITS = /^\d+$/;

/** A stored code as GET /vendor/products returns it: variant null = the whole product. */
export interface ProductBarcode { code: string; variant: string | null }

export type BarcodeError =
  | { error: 'invalid_barcode'; reason: 'too_short' | 'too_long' | 'bad_characters' }
  | { error: 'invalid_check_digit' };

/** GTIN mod-10 check (EAN-8/12/13/14): weights 3,1,3,… from the digit left of the check digit. */
export function checkGtin(digits: string): boolean {
  if (!DIGITS.test(digits) || digits.length < 2) return false;
  let sum = 0;
  for (let i = digits.length - 2, w = 3; i >= 0; i -= 1, w = w === 3 ? 1 : 3) sum += Number(digits[i]) * w;
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/** B-2: the key codes are compared by. Total (never throws); the input is trimmed. */
export function codeKey(raw: string | null | undefined): string {
  const code = String(raw ?? '').trim();
  if (DIGITS.test(code)) {
    if (code.length === 12) return `0${code}`;
    if (code.length === 14 && code[0] === '0') return code.slice(1);
    return code;
  }
  return code.toUpperCase();
}

/** B-1 + B-3 on one code → { code, codeKey } or the error the server would give. */
export function validateBarcode(raw: string): { code: string; codeKey: string } | BarcodeError {
  const code = String(raw ?? '').trim();
  if (code.length < BARCODE_MIN) return { error: 'invalid_barcode', reason: 'too_short' };
  if (code.length > BARCODE_MAX) return { error: 'invalid_barcode', reason: 'too_long' };
  if (!PRINTABLE.test(code)) return { error: 'invalid_barcode', reason: 'bad_characters' };
  if (DIGITS.test(code) && [12, 13, 14].includes(code.length) && !checkGtin(code)) return { error: 'invalid_check_digit' };
  return { code, codeKey: codeKey(code) };
}

/** §6.2 step 3: text that may be a code worth looking up: 4–48 printable ASCII characters, no spaces (as the app). */
export const looksLikeCode = (raw: string) => {
  const s = raw.trim();
  return s.length >= BARCODE_MIN && s.length <= BARCODE_MAX && PRINTABLE.test(s);
};

/** A product row loaded while the tool was on carries a `barcodes` key; without it we don't know its codes. */
export const hasBarcodesKey = (p: { barcodes?: unknown } | null | undefined): boolean => !!p && Array.isArray(p.barcodes);

/** The barcodes of a product from GET /vendor/products (absent while the tool is off). */
export const barcodesOf = (p: VendorProduct): ProductBarcode[] =>
  (Array.isArray(p.barcodes) ? p.barcodes : []).filter((b): b is ProductBarcode => !!b && typeof b.code === 'string');

export type LocalMatch =
  | { kind: 'barcode'; product: VendorProduct; variant: string | null }
  | { kind: 'sku'; products: VendorProduct[] };

/**
 * B-9 against a loaded list: a barcode match (by codeKey) wins; else the SKU matched exactly (trimmed,
 * case-insensitive), which may give several. null when nothing matches.
 */
export function matchLocal(products: VendorProduct[], raw: string): LocalMatch | null {
  const text = raw.trim();
  if (!text) return null;
  const key = codeKey(text);
  for (const p of products) {
    const hit = barcodesOf(p).find(b => codeKey(b.code) === key);
    if (hit) return { kind: 'barcode', product: p, variant: hit.variant || null };
  }
  const lower = text.toLowerCase();
  const bySku = products.filter(p => typeof p.sku === 'string' && p.sku.trim().toLowerCase() === lower);
  return bySku.length ? { kind: 'sku', products: bySku } : null;
}

/** Page search (§6.1): does any of the product's codes match the typed text (by codeKey)? */
export const productHasCode = (p: VendorProduct, raw: string) => {
  const key = codeKey(raw);
  return !!key && barcodesOf(p).some(b => codeKey(b.code) === key);
};
