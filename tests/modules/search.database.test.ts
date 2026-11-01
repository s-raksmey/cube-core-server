import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/src/lib/db";
import type { SessionPayload } from "@/src/lib/auth/session";
import { listSubTenants } from "@/src/modules/tenants/tenant.service";
import { listMainTenantUsers } from "@/src/modules/users/main-user-query.service";
import { listManagedSubTenantUsers, listTenantUsers } from "@/src/modules/tenants/tenant-user-query.service";
import { listArticles } from "@/src/modules/articles/article.service";
import { listCategories, listSubcategories } from "@/src/modules/tenants/category.service";
import { listTags } from "@/src/modules/tenants/tag.service";
import { publicWebsiteArticlesForHostname } from "@/src/modules/articles/public-article.service";

// Requires a migrated, seeded test database with the normal role permissions.
const databaseDescribe = process.env.RUN_SEARCH_DATABASE_TESTS === "1" ? describe.sequential : describe.skip;
databaseDescribe("search against PostgreSQL", () => {
  const token = randomUUID().replaceAll("-", "");
  const tenantA = randomUUID(), tenantB = randomUUID();
  const adminId = randomUUID(), editorId = randomUUID(), mainId = randomUUID(), otherId = randomUUID();
  const categoryA = randomUUID(), categoryB = randomUUID(), subcategoryA = randomUUID(), subcategoryB = randomUUID();
  const tagA = randomUUID(), tagB = randomUUID(), articleA = randomUUID();
  const hostname = `website-${token}.example.test`;
  const managementHostname = `management-${token}.example.test`;
  const session: SessionPayload = { tenantId: tenantA, userId: adminId, role: "ADMIN", audience: "TENANT_APP", sessionId: randomUUID() };
  const editor: SessionPayload = { ...session, userId: editorId, role: "EDITOR" };
  let main: SessionPayload;

  beforeAll(async () => {
    const mainTenant = await prisma.tenant.findFirstOrThrow({ where: { type: "MAIN", deletedAt: null } });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: "ADMIN" } });
    const editorRole = await prisma.role.findUniqueOrThrow({ where: { code: "EDITOR" } });
    const mainRole = await prisma.role.findUniqueOrThrow({ where: { code: "SUPERADMIN" } });
    main = { ...session, userId: mainId, tenantId: mainTenant.uuid, role: "SUPERADMIN", audience: "ADMIN_CONSOLE" };
    await prisma.tenant.createMany({ data: [tenantA, tenantB].map((uuid, index) => ({ uuid, name: `TenantName${token}${index}`, slug: `tenant-slug-${token}-${index}`, type: "SUB", status: "ACTIVE" })) });
    await prisma.tenantDomain.createMany({ data: [
      { tenantUuid: tenantA, hostname, purpose: "WEBSITE", status: "ACTIVE", verifiedAt: new Date() },
      { tenantUuid: tenantA, hostname: managementHostname, purpose: "MANAGEMENT", status: "ACTIVE", verifiedAt: new Date() },
    ] });
    await prisma.user.createMany({ data: [adminId, editorId, mainId, otherId].map((uuid, index) => ({
      uuid, firstName: `First${token}${index}`, lastName: `Last${token}${index}`, username: `username${token}${index}`,
      email: `email${token}${index}@example.test`, status: "ACTIVE", activatedAt: new Date(),
    })) });
    await prisma.tenantMembership.createMany({ data: [
      { tenantUuid: tenantA, userUuid: adminId, roleUuid: adminRole.uuid },
      { tenantUuid: tenantA, userUuid: editorId, roleUuid: editorRole.uuid },
      { tenantUuid: mainTenant.uuid, userUuid: mainId, roleUuid: mainRole.uuid },
      { tenantUuid: tenantB, userUuid: otherId, roleUuid: adminRole.uuid },
    ] });
    for (const [tenantUuid, categoryUuid, subcategoryUuid, tagUuid] of [[tenantA, categoryA, subcategoryA, tagA], [tenantB, categoryB, subcategoryB, tagB]]) {
      await prisma.category.create({ data: { uuid: categoryUuid, tenantUuid, name: `CategoryName${token}`, slug: `category-slug-${token}`, translations: { create: [{ locale: "en", name: `CategoryName${token}` }, { locale: "km", name: `ប្រភេទ${token}` }] } } });
      await prisma.subcategory.create({ data: { uuid: subcategoryUuid, tenantUuid, categoryUuid, slug: `subcategory-slug-${token}`, translations: { create: [{ locale: "en", name: `SubcategoryName${token}` }, { locale: "km", name: `ប្រភេទរង${token}` }] } } });
      await prisma.tag.create({ data: { uuid: tagUuid, tenantUuid, name: `TagName${token}`, slug: `tag-slug-${token}`, translations: { create: [{ locale: "km", name: `ស្លាក${token}` }] } } });
    }
    await prisma.article.create({ data: { uuid: articleA, tenantUuid: tenantA, categoryUuid: categoryA, subcategoryUuid: subcategoryA,
      title: `Title${token}`, slug: `article-slug-${token}`, content: `BodyOnly${token}`, status: "PUBLISHED", publishedAt: new Date(), createdByUuid: adminId,
      translations: { create: [{ locale: "km", title: `ព័ត៌មាន${token}`, content: "មាតិកា" }] },
    } });
    await prisma.articleTag.create({ data: { articleUuid: articleA, tagUuid: tagA, tenantUuid: tenantA } });
    await prisma.article.createMany({ data: ["DRAFT", "IN_REVIEW", "SCHEDULED", "ARCHIVED", "PUBLISHED"].map((status, index) => ({
      tenantUuid: tenantA, categoryUuid: categoryA, subcategoryUuid: subcategoryA, title: `Private${token}`,
      slug: `private-${token}-${index}`, status: status as "DRAFT" | "IN_REVIEW" | "SCHEDULED" | "ARCHIVED" | "PUBLISHED",
      publishedAt: status === "PUBLISHED" ? new Date(Date.now() + 86400000) : null, createdByUuid: editorId,
    })) });
    await prisma.article.create({ data: { tenantUuid: tenantB, categoryUuid: categoryB, subcategoryUuid: subcategoryB, title: `Title${token}`,
      slug: `article-slug-${token}`, status: "PUBLISHED", publishedAt: new Date(), createdByUuid: otherId } });
    await prisma.article.create({ data: { tenantUuid: tenantA, categoryUuid: categoryA, subcategoryUuid: subcategoryA, title: "x".repeat(160), slug: `long-${token}` } });
  });
  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { uuid: { in: [tenantA, tenantB] } } });
    await prisma.user.deleteMany({ where: { uuid: { in: [adminId, editorId, mainId, otherId] } } });
    await prisma.$disconnect();
  });

  it("matches tenant names, slugs and both domain mappings", async () => {
    for (const search of [`TenantName${token}0`, `tenant-slug-${token}-0`, hostname, managementHostname]) {
      expect((await listSubTenants(main, { search })).items.map((item) => item.id)).toEqual([tenantA]);
    }
  });
  it("matches every user field within the correct management scope", async () => {
    for (const field of ["First", "Last", "username", "email"]) {
      expect((await listMainTenantUsers(main, { search: `${field}${token}2` })).items.map((item) => item.id)).toEqual([mainId]);
      expect((await listManagedSubTenantUsers(main, { tenantId: tenantA, search: `${field}${token}0` })).items.map((item) => item.id)).toEqual([adminId]);
      expect((await listTenantUsers(session, { search: `${field}${token}0` })).items.map((item) => item.id)).toEqual([adminId]);
      expect((await listTenantUsers(session, { search: `${field}${token}3` })).total).toBe(0);
    }
  });
  it("matches taxonomy names, slugs and Khmer translations without crossing tenants", async () => {
    for (const query of [`CategoryName${token}`, `category-slug-${token}`, `ប្រភេទ${token}`])
      expect((await listCategories(session, query)).items.map((item) => item.id)).toEqual([categoryA]);
    for (const query of [`SubcategoryName${token}`, `subcategory-slug-${token}`, `ប្រភេទរង${token}`])
      expect((await listSubcategories(session, categoryA, query)).items.map((item) => item.id)).toEqual([subcategoryA]);
    expect((await listSubcategories(session, categoryB, token)).total).toBe(0);
    for (const query of [`TagName${token}`, `tag-slug-${token}`, `ស្លាក${token}`])
      expect((await listTags(session, query)).items.map((item) => item.id)).toEqual([tagA]);
  });
  it("supports exact, partial, case-insensitive, trimmed and translated article searches", async () => {
    for (const search of [`Title${token}`, `TITLE${token}`, `  Title${token}  `, `article-slug-${token}`, `ព័ត៌មាន${token}`, token.slice(0, 12)]) {
      const page = await listArticles(session, { search, status: "PUBLISHED", categoryId: categoryA });
      // Future-dated PUBLISHED rows are visible internally, but do not match these terms.
      expect(page.items.map((item) => item.id)).toEqual(search === token.slice(0, 12) ? expect.arrayContaining([articleA]) : [articleA]);
    }
    expect((await listArticles(session, { search: `BodyOnly${token}` })).total).toBe(0);
    expect((await listArticles(session, { search: "x".repeat(160) })).total).toBe(1);
    await expect(listArticles(session, { search: "x".repeat(161) })).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
  });
  it("preserves filters, counts, ownership and deterministic pages", async () => {
    const normal = await listArticles(session, { search: token, pageSize: 1 });
    const next = await listArticles(session, { search: token, page: 2, pageSize: 1 });
    expect(next).toMatchObject({ total: normal.total, page: 2, pageSize: 1 });
    expect(next.items[0].id).not.toBe(normal.items[0].id);
    expect((await listArticles(session, { search: token, page: 2, pageSize: 1 })).items).toEqual(next.items);
    expect((await listArticles(session, { search: token, scope: "MY" })).items.map((item) => item.id)).toEqual([articleA]);
    expect((await listArticles(editor, { search: token, scope: "MY" })).total).toBe(5);
    expect((await listArticles(session, { search: token, scope: "REVIEW" })).items.every((item) => item.status === "IN_REVIEW")).toBe(true);
    expect((await listArticles(session, { search: token, categoryId: categoryB })).total).toBe(0);
    const empty = await listArticles(session, { search: "" });
    expect((await listArticles(session, { search: "   " })).total).toBe(empty.total);
    expect((await listArticles(session, { pageSize: 100 })).pageSize).toBe(100);
  });
  it("keeps public status, timing, tenant and taxonomy filters for search", async () => {
    for (const search of [`Title${token}`, `article-slug-${token}`, `ព័ត៌មាន${token}`, token]) {
      const page = await publicWebsiteArticlesForHostname(hostname, tenantA, { search, categorySlug: `category-slug-${token}`, subcategorySlug: `subcategory-slug-${token}`, tagSlug: `tag-slug-${token}` });
      expect(page.items.map((item) => item.id)).toEqual([articleA]);
      expect(page.total).toBe(1);
    }
    expect((await publicWebsiteArticlesForHostname(hostname, tenantA, { search: `Private${token}` })).total).toBe(0);
    await expect(publicWebsiteArticlesForHostname(hostname, tenantB, { search: token })).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    await expect(listSubTenants(editor)).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    await expect(listManagedSubTenantUsers(session, { tenantId: tenantB })).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });
});
