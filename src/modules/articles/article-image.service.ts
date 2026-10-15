import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { validationError } from "@/src/lib/errors";

export type ArticleImageUpload = {
  fileName: string;
  mimeType: string;
  contentBase64: string;
};

const storageRoot = resolve(process.env.LOCAL_STORAGE_PATH ?? join(process.cwd(), "storage"));
const maxBytes = 1000 * 1024;
const formats: Record<string, { extensions: string[]; extension: string; matches: (bytes: Buffer) => boolean }> = {
  "image/png": {
    extensions: [".png"], extension: ".png",
    matches: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  },
  "image/jpeg": {
    extensions: [".jpg", ".jpeg"], extension: ".jpg",
    matches: (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  "image/webp": {
    extensions: [".webp"], extension: ".webp",
    matches: (bytes) => bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP",
  },
};

export function decodeArticleImage(upload: ArticleImageUpload) {
  const format = formats[upload.mimeType];
  if (!format || !format.extensions.includes(extname(upload.fileName).toLowerCase())) {
    throw validationError("Choose a PNG, JPEG, or WebP image with a matching file extension");
  }
  if (!upload.contentBase64 || upload.contentBase64.length > Math.ceil(maxBytes * 4 / 3) + 4 ||
    upload.contentBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(upload.contentBase64)) {
    throw validationError("Image must be 1000 KB or smaller");
  }
  const bytes = Buffer.from(upload.contentBase64, "base64");
  if (!bytes.length || bytes.length > maxBytes || !format.matches(bytes)) {
    throw validationError("Image content does not match its image type or exceeds 1000 KB");
  }
  return { bytes, extension: format.extension };
}

async function saveImage(upload: ArticleImageUpload, ...folders: string[]) {
  const { bytes, extension } = decodeArticleImage(upload);
  const relative = join(...folders, `${randomUUID()}${extension}`);
  const destination = resolve(storageRoot, relative);
  try {
    await mkdir(resolve(destination, ".."), { recursive: true });
    await writeFile(destination, bytes, { mode: 0o600 });
  } catch (error) {
    await rm(destination, { force: true }).catch(() => {});
    throw error;
  }
  return `/storage/${relative.replaceAll("\\", "/")}`;
}

export async function saveArticleThumbnail(tenantId: string, articleId: string, upload: ArticleImageUpload) {
  return saveImage(upload, "tenants", tenantId, "articles", articleId);
}

export async function saveArticleContentImage(tenantId: string, upload: ArticleImageUpload) {
  return saveImage(upload, "tenants", tenantId, "article-content");
}

export async function removeArticleThumbnail(tenantId: string, articleId: string, url: string | null | undefined) {
  const prefix = `/storage/tenants/${tenantId}/articles/${articleId}/`;
  if (!url?.startsWith(prefix) || !/^[0-9a-f-]{36}\.(?:png|jpg|webp)$/.test(url.slice(prefix.length))) return;
  await rm(resolve(storageRoot, url.slice("/storage/".length)), { force: true });
}
