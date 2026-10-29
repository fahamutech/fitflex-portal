// Build-time feature flags. NEXT_PUBLIC_* values are inlined by Next.js when
// the portal is built, so changing one needs a rebuild. Every flag is off
// unless its variable is exactly "true".

/** Photo hero login layout (design spec photo-hero-screens §12, §13). Default off. */
export const PHOTO_HERO_UI = process.env.NEXT_PUBLIC_PHOTO_HERO_UI === 'true';

/** Admin "App photos" screen and its nav item (design spec photo-hero-screens §36; plan slice 5). Default off. */
export const HERO_IMAGES_ADMIN = process.env.NEXT_PUBLIC_HERO_IMAGES_ADMIN === 'true';

/**
 * The login photo panel reads the `portalLogin` slot from GET /app/hero-images at runtime (plan slice 5).
 * Only has an effect when the photo panel itself is on (NEXT_PUBLIC_PHOTO_HERO_UI). Default off.
 */
export const HERO_IMAGES_REMOTE = process.env.NEXT_PUBLIC_HERO_IMAGES_REMOTE === 'true';

/**
 * Marathon & Running Events module, slice 2 (design spec events-s2-organizer-and-discovery §3, §13): the
 * organizer area (/organizer/*), the admin moderation queue (/admin/events) and their nav items and login link.
 * Off, those pages render the "not available yet" state. The server has its own EVENTS_MODULE flag. Default off.
 */
export const EVENTS_MODULE = process.env.NEXT_PUBLIC_EVENTS_MODULE === 'true';

/**
 * Partner photos (design spec photo-hero-screens §43, §44.5; backend functions#277): the admin "Partner photos"
 * queue (/admin/partner-media) and its nav item, and the "Home photo and logo" row action and dialog on the gyms,
 * trainers and vendors pages. Off, the nav item and row actions are absent and the page is the not-found page.
 * The server has its own PARTNER_MEDIA flag. Default off.
 */
export const PARTNER_MEDIA_ADMIN = process.env.NEXT_PUBLIC_PARTNER_MEDIA_ADMIN === 'true';

/**
 * Public gym page opened from a gym's QR code (/g/?q=...; backend POST /public/gyms/resolve, functions#281):
 * read-only profile, no sign-in. Off, the page shows the not-found state and makes no request. The server has its
 * own WEB_GYM_PROFILE flag. Default off.
 */
export const WEB_GYM_PROFILE = process.env.NEXT_PUBLIC_WEB_GYM_PROFILE === 'true';
