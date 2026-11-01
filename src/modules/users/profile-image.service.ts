import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { validationError } from "@/src/lib/errors";
import { decodeArticleImage, type ArticleImageUpload } from "@/src/modules/articles/article-image.service";

const storageRoot = resolve(process.env.LOCAL_STORAGE_PATH ?? join(process.cwd(), "storage"));

export async function saveProfileImage(userId: string, upload: ArticleImageUpload) {
  const { bytes } = decodeArticleImage(upload);
  let optimized: Buffer;
  try {
    optimized = await sharp(bytes, { limitInputPixels: 16_000_000, animated: false })
      .rotate().resize(256, 256, { fit: "cover" }).webp({ quality: 85 }).toBuffer();
  } catch { throw validationError("Choose a valid PNG, JPEG, or WebP image up to 16 megapixels"); }
  const relative = `users/${userId}/avatars/${randomUUID()}.webp`;
  const destination = resolve(storageRoot, relative);
  try {
    await mkdir(resolve(destination, ".."), { recursive: true });
    await writeFile(destination, optimized, { mode: 0o600 });
  } catch (error) {
    await rm(destination, { force: true }).catch(() => undefined);
    throw error;
  }
  return `/storage/${relative}`;
}

export async function removeProfileImage(userId: string, path: string | null) {
  const prefix = `/storage/users/${userId}/avatars/`;
  if (!path?.startsWith(prefix) || !/^[0-9a-f-]{36}\.webp$/.test(path.slice(prefix.length))) return;
  await rm(resolve(storageRoot, path.slice("/storage/".length)), { force: true });
}
