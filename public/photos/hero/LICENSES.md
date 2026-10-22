# Hero photo licences

No row, no ship (design spec `docs/design/photo-hero-screens.md` §8.1). Every photo in this folder has one row below.

The login photo is a FitFlex-owned, AI-generated image with no people (owner approval 2026-10-22). It replaces the interim Pexels stand-in (4716814). Metadata (EXIF, ICC, XMP, GPS) is stripped from every file.

| Files | Source | Author | Licence | Obtained | People | Location / gym consent | Permitted use | Expiry |
|---|---|---|---|---|---|---|---|---|
| `login-panel.avif`, `login-panel.webp`, `login-panel.jpg` (3:4, full frame 0,0,960,1280 → 960×1280); `login-band.avif`, `login-band.webp`, `login-band.jpg` (16:5 crop 0,250,960,550 → 960×300; the "FitFlex Africa" sign is in the upper right) | FitFlex Africa, AI-generated via Figma AI (gpt-image-2.5), 2026-10-22, no people (lounge scene, made in the owner's Figma file); source kept in the parent repo at `docs/design/generated/gen-20-portal-lounge.png` (960×1280) | FitFlex Africa | FitFlex-owned (AI-generated, 2026-10-22) | Generated 2026-10-22 | None (no people) | Not a real place or partner gym; the sign is FitFlex's own name | Portal login photo panel (`/login`, behind `NEXT_PUBLIC_PHOTO_HERO_UI`) | None |
