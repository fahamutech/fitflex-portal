'use client';
import { PartnerMediaReview } from '@/components/partner-media-review';
import { PARTNER_MEDIA_ADMIN } from '@/lib/flags';
import NotFound from '../../not-found';

// Partner photos (design spec photo-hero-screens §43). Without NEXT_PUBLIC_PARTNER_MEDIA_ADMIN=true at build
// time the page is the portal's not-found page and makes no request (AC-P31). Portal staff without
// moderation or moderation_decide are sent away by the Shell before this renders.
export default function AdminPartnerMediaPage() {
  if (!PARTNER_MEDIA_ADMIN) return <NotFound />;
  return <PartnerMediaReview />;
}
