import { ArticleStatus } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";

/** Publishes due articles from durable database state. Safe to run on several server instances. */
export async function publishDueArticles(now = new Date()) {
  const due = await prisma.article.findMany({
    where: { status: ArticleStatus.SCHEDULED, scheduledAt: { lte: now } },
    select: { uuid: true, tenantUuid: true, title: true, scheduledAt: true, scheduledByUuid: true },
    orderBy: [{ scheduledAt: "asc" }, { uuid: "asc" }], take: 100,
  });
  let published = 0;
  for (const article of due) {
    const didPublish = await prisma.$transaction(async (tx) => {
      const changed = await tx.article.updateMany({
        where: { uuid: article.uuid, tenantUuid: article.tenantUuid,
          status: ArticleStatus.SCHEDULED, scheduledAt: article.scheduledAt },
        data: { status: ArticleStatus.PUBLISHED, publishedAt: now,
          publishedByUuid: article.scheduledByUuid, scheduledAt: null, scheduledByUuid: null },
      });
      if (changed.count !== 1) return false;
      await writeAuthAudit({ action: "ARTICLE_PUBLISHED", actorUserUuid: article.scheduledByUuid,
        tenantUuid: article.tenantUuid, targetType: "article", targetUuid: article.uuid,
        metadata: { title: article.title, previousStatus: "SCHEDULED", newStatus: "PUBLISHED",
          scheduledAt: article.scheduledAt?.toISOString() } }, tx);
      return true;
    });
    if (didPublish) published += 1;
  }
  return published;
}

export function startArticleScheduler() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await publishDueArticles(); }
    catch (error) { console.error("Article scheduler failed", error); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
