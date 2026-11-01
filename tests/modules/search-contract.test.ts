import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/src/lib/auth/session";

const mocks = vi.hoisted(() => {
  const model = () => ({ findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn() });
  return {
    tenant: model(), tenantMembership: model(), category: model(), subcategory: model(), tag: model(), article: model(),
    permissions: vi.fn(), requirePermission: vi.fn(), main: vi.fn(), active: vi.fn(), hostname: vi.fn(), local: vi.fn(),
  };
});
vi.mock("@/src/lib/db", () => ({ prisma: { ...mocks, $transaction: (queries: Promise<unknown>[]) => Promise.all(queries) } }));
vi.mock("@/src/modules/roles/role-permission.service", () => ({
  getTenantUserPermissions: mocks.permissions, requireTenantUserPermission: mocks.requirePermission,
}));
vi.mock("@/src/modules/users/account", () => ({ getMainTenant: mocks.main, displayFullName: () => "Test User" }));
vi.mock("@/src/modules/tenants/tenant-domain.service", () => ({
  findActiveTenantById: mocks.active, findActiveTenantByHostname: mocks.hostname,
}));
vi.mock("@/src/modules/tenants/local-development-tenant.service", () => ({ findLocalDevelopmentTenant: mocks.local }));

import { listSubTenants } from "@/src/modules/tenants/tenant.service";
import { listMainTenantUsers } from "@/src/modules/users/main-user-query.service";
import { listManagedSubTenantUsers, listTenantUsers } from "@/src/modules/tenants/tenant-user-query.service";
import { listCategories, listSubcategories } from "@/src/modules/tenants/category.service";
import { listTags } from "@/src/modules/tenants/tag.service";
import { listArticles } from "@/src/modules/articles/article.service";
import { publicWebsiteArticles, publicWebsiteArticlesForHostname } from "@/src/modules/articles/public-article.service";

const tenantId = "11111111-1111-4111-8111-111111111111";
const categoryId = "22222222-2222-4222-8222-222222222222";
const session: SessionPayload = { tenantId, userId: "user-a", audience: "TENANT_APP", role: "ADMIN", sessionId: "session" };
const mainSession: SessionPayload = { ...session, tenantId: "main", audience: "ADMIN_CONSOLE", role: "SUPERADMIN" };

beforeEach(() => {
  vi.resetAllMocks();
  for (const model of [mocks.tenant, mocks.tenantMembership, mocks.category, mocks.subcategory, mocks.tag, mocks.article]) {
    model.findMany.mockResolvedValue([]); model.count.mockResolvedValue(51); model.findFirst.mockResolvedValue({ uuid: tenantId });
  }
  mocks.main.mockResolvedValue({ uuid: "main" });
  mocks.active.mockResolvedValue({ uuid: tenantId });
  mocks.hostname.mockResolvedValue({ uuid: tenantId });
  mocks.permissions.mockResolvedValue(["ARTICLE_VIEW", "ARTICLE_REVIEW", "CATEGORY_VIEW", "CATEGORY_VIEW_SUBCATEGORY"]);
});

describe("search read services", () => {
  const cases = [
    { name: "sub-tenants", model: mocks.tenant, run: () => listSubTenants(mainSession, { search: " news ", page: 2 }), fields: ["name", "slug", "domains"] },
    { name: "main users", model: mocks.tenantMembership, run: () => listMainTenantUsers(mainSession, { search: " news ", page: 2 }), fields: ["firstName", "lastName", "email", "username"] },
    { name: "selected tenant users", model: mocks.tenantMembership, run: () => listManagedSubTenantUsers(mainSession, { tenantId, search: " news ", page: 2 }), fields: ["firstName", "lastName", "email", "username"] },
    { name: "tenant users", model: mocks.tenantMembership, run: () => listTenantUsers(session, { search: " news ", page: 2 }), fields: ["firstName", "lastName", "email", "username"] },
    { name: "categories", model: mocks.category, run: () => listCategories(session, " news ", 2), fields: ["name", "slug", "translations"] },
    { name: "subcategories", model: mocks.subcategory, run: () => listSubcategories(session, categoryId, " news ", 2), fields: ["slug", "translations"] },
    { name: "tags", model: mocks.tag, run: () => listTags(session, " news ", 2), fields: ["name", "slug", "translations"] },
    { name: "articles", model: mocks.article, run: () => listArticles(session, { search: " news ", page: 2, status: "PUBLISHED", categoryId }), fields: ["title", "slug", "translations"] },
    { name: "public news", model: mocks.article, run: () => publicWebsiteArticles(tenantId, { search: " news ", page: 2, categorySlug: "news", subcategorySlug: "local", tagSlug: "ai" }), fields: ["title", "slug", "translations"] },
  ];
  it.each(cases)("$name uses matching count, bounded paging, explicit projection and stable ordering", async ({ model, run, fields }) => {
    await expect(run()).resolves.toMatchObject({ items: [], total: 51, page: 2, pageSize: 25 });
    const args = model.findMany.mock.calls[0][0];
    expect(model.count.mock.calls[0][0].where).toBe(args.where);
    expect(args).toMatchObject({ skip: 25, take: 25, select: expect.any(Object) });
    expect(args.include).toBeUndefined();
    expect(args.orderBy.at(-1)).toHaveProperty("uuid");
    const where = JSON.stringify(args.where);
    for (const field of fields) expect(where).toContain(`"${field}"`);
    expect(where).toContain('"contains":"news"');
    expect(where).toContain('"mode":"insensitive"');
    expect(where).not.toContain(" news ");
    const projection = JSON.stringify(args.select);
    for (const field of ["passwordHash", "secret", "recoveryCodes", "tokenHash", "content"]) expect(projection).not.toContain(`"${field}"`);
  });
  it.each([
    () => listSubTenants(mainSession, { search: "x".repeat(161) }),
    () => listMainTenantUsers(mainSession, { search: "x".repeat(161) }),
    () => listManagedSubTenantUsers(mainSession, { tenantId, search: "x".repeat(161) }),
    () => listTenantUsers(session, { search: "x".repeat(161) }),
    () => listCategories(session, "x".repeat(161)),
    () => listSubcategories(session, categoryId, "x".repeat(161)),
    () => listTags(session, "x".repeat(161)),
    () => listArticles(session, { search: "x".repeat(161) }),
    () => publicWebsiteArticles(tenantId, { search: "x".repeat(161) }),
  ])("rejects oversized search text before reading or counting results", async (run) => {
    await expect(run()).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    for (const model of [mocks.tenantMembership, mocks.category, mocks.subcategory, mocks.tag, mocks.article]) {
      expect(model.findMany).not.toHaveBeenCalled();
      expect(model.count).not.toHaveBeenCalled();
    }
  });
  it("searches both domain purposes through hostname mappings", async () => {
    await listSubTenants(mainSession, { search: "example.test" });
    expect(mocks.tenant.findMany.mock.calls[0][0].where.OR).toContainEqual({ domains: { some: { hostname: { contains: "example.test", mode: "insensitive" } } } });
  });
  it("combines article status, category, tenant and search", async () => {
    await listArticles(session, { search: "news", status: "PUBLISHED", categoryId });
    expect(mocks.article.findMany.mock.calls[0][0].where).toMatchObject({ tenantUuid: tenantId, categoryUuid: categoryId, status: "PUBLISHED", OR: expect.any(Array) });
  });
  it("combines MY ownership and REVIEW status with the submitted filters", async () => {
    await listArticles(session, { search: "news", scope: "MY" });
    expect(mocks.article.findMany.mock.calls[0][0].where.createdByUuid).toBe(session.userId);
    await listArticles(session, { search: "news", scope: "REVIEW", status: "PUBLISHED" });
    expect(mocks.article.findMany.mock.calls[1][0].where).toMatchObject({ status: "PUBLISHED", AND: [{ status: "IN_REVIEW" }] });
  });
  it("keeps subcategory parent and tenant restrictions outside search branches", async () => {
    await listSubcategories(session, categoryId, "news");
    expect(mocks.subcategory.findMany.mock.calls[0][0].where).toMatchObject({ tenantUuid: tenantId, categoryUuid: categoryId, OR: expect.any(Array) });
  });
  it("keeps all public filters and publication timing outside search branches", async () => {
    await publicWebsiteArticles(tenantId, { search: "news", categorySlug: "news", subcategorySlug: "local", tagSlug: "ai" });
    expect(mocks.article.findMany.mock.calls[0][0].where).toMatchObject({ tenantUuid: tenantId, status: "PUBLISHED", publishedAt: { lte: expect.any(Date) }, category: { slug: "news" }, subcategory: { slug: "local" }, tags: { some: { tag: { slug: "ai" } } } });
  });
});

describe("search authorization boundaries", () => {
  it.each(["ADMIN", "EDITOR"])("rejects %s access to MAIN search", async (role) => {
    await expect(listSubTenants({ ...session, role }, {})).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    await expect(listMainTenantUsers({ ...session, role }, {})).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    await expect(listManagedSubTenantUsers({ ...session, role }, { tenantId })).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.tenantMembership.findMany).not.toHaveBeenCalled();
  });
  it("rejects a SuperAdmin session belonging to a SUB tenant", async () => {
    await expect(listSubTenants({ ...mainSession, tenantId }, {})).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    await expect(listMainTenantUsers({ ...mainSession, tenantId }, {})).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });
  it("rejects MAIN sessions on tenant user and content search", async () => {
    await expect(listTenantUsers(mainSession)).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    await expect(listArticles(mainSession, {})).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    await expect(listCategories(mainSession)).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });
  it("checks selected tenant existence before reading users", async () => {
    mocks.tenant.findFirst.mockResolvedValue(null);
    await expect(listManagedSubTenantUsers(mainSession, { tenantId })).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    expect(mocks.tenantMembership.findMany).not.toHaveBeenCalled();
  });
  it("rejects search and count without the required content permission", async () => {
    mocks.permissions.mockResolvedValue([]);
    await expect(listArticles(session, {})).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.article.count).not.toHaveBeenCalled();
  });
  it("requires review permission even when search is present", async () => {
    mocks.permissions.mockResolvedValue(["ARTICLE_VIEW"]);
    await expect(listArticles({ ...session, role: "EDITOR" }, { search: "news", scope: "REVIEW" })).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });
  it("rejects a hostname/tenant mismatch without reading articles", async () => {
    await expect(publicWebsiteArticlesForHostname("news.example.test", categoryId, {})).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    expect(mocks.article.findMany).not.toHaveBeenCalled();
  });
  it("resolves the WEBSITE mapping before searching", async () => {
    await publicWebsiteArticlesForHostname("news.example.test", tenantId, { search: "news" });
    expect(mocks.hostname).toHaveBeenCalledWith("news.example.test", "WEBSITE");
    expect(mocks.article.findMany.mock.calls[0][0].where.tenantUuid).toBe(tenantId);
  });
  it("does not read public articles for an inactive tenant", async () => {
    mocks.active.mockResolvedValue(null);
    await expect(publicWebsiteArticles(tenantId, {})).resolves.toMatchObject({ total: 0, items: [] });
    expect(mocks.article.findMany).not.toHaveBeenCalled();
  });
});
