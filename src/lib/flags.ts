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
