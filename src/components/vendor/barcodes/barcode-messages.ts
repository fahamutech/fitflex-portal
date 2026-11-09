// S8: the text for a barcode refusal (client check or server error, spec §2.3 / §10.2). Always our own EN/SW strings,
// by `error` (+ `reason`); the server's message { en, sw } is only the fallback for an error we do not know.
import type { MessageKey } from '@/lib/i18n';
import { fmt } from '@/lib/vendor';
import { MAX_BARCODES_PER_PRODUCT } from '@/lib/barcode-rules';

export type BarcodeRefusal = {
  error?: string; reason?: string; code?: string | null; name?: string | null; productId?: string | null; variant?: string | null; max?: number;
  message?: { en?: string; sw?: string };
};

export function barcodeErrorText(t: (k: MessageKey) => string, b: BarcodeRefusal | null | undefined): string | null {
  if (!b?.error) return null;
  switch (b.error) {
    case 'invalid_barcode':
      return t(b.reason === 'too_long' ? 'vendor.barcodes.err.tooLong' : b.reason === 'bad_characters' ? 'vendor.barcodes.err.badChars' : 'vendor.barcodes.err.tooShort');
    case 'invalid_check_digit': return t('vendor.barcodes.err.checkDigit');
    case 'duplicate_barcode': return t('vendor.barcodes.err.duplicate');
    // functions#334 L-1: after a deadlock retry that failed twice the holder is unknown (productId and name null).
    case 'barcode_in_use': return b.name ? fmt(t('vendor.barcodes.err.inUse'), { name: b.name }) : t('vendor.barcodes.err.inUseRetry');
    case 'too_many_barcodes': return fmt(t('vendor.barcodes.err.tooMany'), { max: b.max ?? MAX_BARCODES_PER_PRODUCT });
    case 'barcode_variant_not_found': return fmt(t('vendor.barcodes.err.variantGone'), { variant: b.variant ?? '' });
    default: return null;
  }
}

/** The server's own bilingual text for an error we have no key for (S8 errors carry message { en, sw }). */
export const serverMessage = (b: BarcodeRefusal | null | undefined, locale: string) =>
  (locale === 'sw' ? b?.message?.sw : b?.message?.en) || null;
