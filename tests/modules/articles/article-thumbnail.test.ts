import { beforeEach, describe, expect, it, vi } from "vitest";

const files = vi.hoisted(() => ({ mkdir: vi.fn(), writeFile: vi.fn(), rm: vi.fn() }));
vi.mock("node:fs/promises", () => files);

import { decodeArticleImage, removeArticleThumbnail, saveArticleThumbnail, saveArticleContentImage } from "@/src/modules/articles/article-image.service";
import { articleImageUploadSchema } from "@/src/modules/articles/article-validation";

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const upload = { fileName: "photo.png", mimeType: "image/png", contentBase64: png.toString("base64") };
const tenantId = "e65cd85c-a2be-48b2-9bd2-dd9150bd9a43";
const articleId = "0d1a5360-3e64-40bf-a250-a5295f088daa";

beforeEach(() => vi.resetAllMocks());

describe("article thumbnail storage", () => {
  it("validates bytes, MIME type, extension, and size", () => {
    expect(decodeArticleImage(upload).bytes).toEqual(png);
    expect(() => decodeArticleImage({ ...upload, fileName: "photo.jpg" })).toThrow();
    expect(() => decodeArticleImage({ ...upload, mimeType: "image/svg+xml" })).toThrow();
    expect(() => decodeArticleImage({ ...upload, contentBase64: Buffer.from("not an image").toString("base64") })).toThrow();
    const atLimit = { ...upload, contentBase64: Buffer.concat([png, Buffer.alloc(1000 * 1024 - png.length)]).toString("base64") };
    expect(articleImageUploadSchema.safeParse(atLimit).success).toBe(true);
    expect(decodeArticleImage(atLimit).bytes).toHaveLength(1000 * 1024);
    const overLimit = { ...upload, contentBase64: Buffer.alloc(1000 * 1024 + 1).toString("base64") };
    expect(() => decodeArticleImage(overLimit)).toThrow();
    expect(articleImageUploadSchema.safeParse({ ...upload, contentBase64: Buffer.alloc(1000 * 1024 + 4).toString("base64") }).success).toBe(false);
  });

  it("stores under the tenant and article and only removes that article's own image", async () => {
    const url = await saveArticleThumbnail(tenantId, articleId, upload);
    expect(url).toMatch(new RegExp(`^/storage/tenants/${tenantId}/articles/${articleId}/[0-9a-f-]{36}\\.png$`));
    expect(files.writeFile).toHaveBeenCalledWith(expect.stringContaining(articleId), png, { mode: 0o600 });
    await removeArticleThumbnail(tenantId, articleId, url);
    expect(files.rm).toHaveBeenCalledOnce();
    await removeArticleThumbnail(tenantId, articleId, url.replace(articleId, tenantId));
    expect(files.rm).toHaveBeenCalledOnce();
  });

  it("stores inline content images under the authenticated tenant", async () => {
    const url = await saveArticleContentImage(tenantId, upload);
    expect(url).toMatch(new RegExp(`^/storage/tenants/${tenantId}/article-content/[0-9a-f-]{36}\\.png$`));
    expect(files.writeFile).toHaveBeenCalledWith(expect.stringContaining(tenantId), png, { mode: 0o600 });
  });
});
