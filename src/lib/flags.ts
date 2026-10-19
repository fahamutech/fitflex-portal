// Build-time feature flags. NEXT_PUBLIC_* values are inlined by Next.js when
// the portal is built, so changing one needs a rebuild. Every flag is off
// unless its variable is exactly "true".

/** Photo hero login layout (design spec photo-hero-screens §12, §13). Default off. */
export const PHOTO_HERO_UI = process.env.NEXT_PUBLIC_PHOTO_HERO_UI === 'true';
