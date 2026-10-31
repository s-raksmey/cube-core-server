import sharp from "sharp";
import { validationError } from "@/src/lib/errors";
import { ARTICLE_IMAGE_POLICY as policy, ARTICLE_IMAGE_PRESETS, type ArticleImagePreset } from "./article-image.config";

export async function optimizeArticleImage(bytes: Buffer, preset: ArticleImagePreset = "ARTICLE_FEATURED") {
  const dimensions = ARTICLE_IMAGE_PRESETS[preset];
  try {
    const image = sharp(bytes, { failOn: "warning", limitInputPixels: policy.maxInputPixels });
    const source = await image.metadata();
    if (!source.width || !source.height || !["jpeg", "png", "webp"].includes(source.format ?? "") ||
      (source.pages ?? 1) > 1) {
      throw new Error("Unsupported image");
    }
    // Decode and orient once before stripping private metadata. Only the decorative
    // background uses cover; the sharp foreground always retains the entire source.
    const normalized = await image.rotate().toColourspace("srgb").png().toBuffer();
    const foreground = await sharp(normalized)
      .resize({ width: dimensions.width, height: dimensions.height, fit: "inside" })
      .png().toBuffer();
    const { data, info } = await sharp(normalized)
      .resize({ width: dimensions.width, height: dimensions.height, fit: "cover" })
      .blur(policy.backgroundBlur)
      .composite([{ input: foreground, gravity: "centre" }])
      .avif({ quality: policy.avifQuality, effort: policy.avifEffort, lossless: false, chromaSubsampling: "4:4:4" })
      .toBuffer({ resolveWithObject: true });
    const output = await sharp(data).metadata();
    if (output.compression !== "av1" || output.width !== info.width || output.height !== info.height ||
      info.width !== dimensions.width || info.height !== dimensions.height || output.exif || output.xmp) {
      throw new Error("Invalid optimized image");
    }
    return { bytes: data, width: info.width, height: info.height, format: "avif" as const,
      mimeType: "image/avif" as const, aspectRatio: info.width / info.height, fileSize: data.length };
  } catch {
    throw validationError("Image could not be processed. Choose a valid, static PNG, JPEG, or WebP image up to 40 megapixels");
  }
}
