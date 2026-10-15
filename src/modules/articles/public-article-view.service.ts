import { createHash } from "node:crypto";
import { TenantDomainPurpose } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import { findLocalDevelopmentTenant } from "@/src/modules/tenants/local-development-tenant.service";
import { findActiveTenantByHostname } from "@/src/modules/tenants/tenant-domain.service";
import { publicArticleWhere } from "@/src/modules/articles/public-article.service";

const inputSchema = z.object({
  hostname: z.string().trim().toLowerCase().max(253),
  articleId: z.string().uuid(),
  visitorId: z.string().uuid(),
});

// One counted view per anonymous visitor and article in each UTC hour.
export const PUBLIC_ARTICLE_VIEW_DEDUP_MS = 60 * 60 * 1000;

export async function recordPublicWebsiteArticleView(input: unknown): Promise<boolean> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return false;
  const { hostname, articleId, visitorId } = parsed.data;
  const tenant = hostname === "localhost" && process.env.NODE_ENV !== "production"
    ? await findLocalDevelopmentTenant()
    : await findActiveTenantByHostname(hostname, TenantDomainPurpose.WEBSITE);
  if (!tenant) return false;

  const now = new Date();
  const publicWhere = publicArticleWhere(tenant.uuid, now);
  const visitorKey = createHash("sha256").update(`${articleId}:${visitorId}`).digest("hex");
  const bucketStart = new Date(Math.floor(now.getTime() / PUBLIC_ARTICLE_VIEW_DEDUP_MS) * PUBLIC_ARTICLE_VIEW_DEDUP_MS);

  return prisma.$transaction(async (tx) => {
    const article = await tx.article.findFirst({
      where: { ...publicWhere, uuid: articleId }, select: { uuid: true },
    });
    if (!article) return false;
    const inserted = await tx.articleView.createMany({
      data: { tenantUuid: tenant.uuid, articleUuid: articleId, visitorKey, bucketStart, viewedAt: now },
      skipDuplicates: true,
    });
    if (!inserted.count) return false;
    const updated = await tx.article.updateMany({
      where: { ...publicWhere, uuid: articleId }, data: { viewCount: { increment: 1 } },
    });
    if (!updated.count) throw new Error("Article became unavailable while recording a view");
    return true;
  });
}
