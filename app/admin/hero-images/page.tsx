'use client';
import { HeroImageManager } from '@/components/hero-image-manager';
import { HERO_IMAGES_ADMIN } from '@/lib/flags';
import NotFound from '../../not-found';

// App photos (design spec photo-hero-screens §36). Without NEXT_PUBLIC_HERO_IMAGES_ADMIN=true at
// build time the page is the portal's not-found page and makes no request (AC-N1). Portal staff
// without the brand_media scope are sent away by the Shell before this renders (AC-N2).
export default function AdminHeroImagesPage() {
  if (!HERO_IMAGES_ADMIN) return <NotFound />;
  return <HeroImageManager />;
}
