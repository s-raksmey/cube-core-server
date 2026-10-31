// Shared server policy for featured and Markdown content image uploads.
export const ARTICLE_IMAGE_POLICY = Object.freeze({
  maxInputBytes: 3000 * 1024,
  avifQuality: 80,
  avifEffort: 4,
  backgroundBlur: 32,
  maxInputPixels: 40_000_000,
});

export const ARTICLE_IMAGE_PRESETS = Object.freeze({
  ARTICLE_FEATURED: { width: 1600, height: 900 },
  ARTICLE_HERO: { width: 1920, height: 640 },
});
export type ArticleImagePreset = keyof typeof ARTICLE_IMAGE_PRESETS;
