import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({ tenant: vi.fn(), permission: vi.fn(), list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock("@/src/lib/db", () => ({ prisma: { tenant: { findFirst: mocks.tenant }, tag: { findMany: mocks.list, findFirst: mocks.get, create: mocks.create, update: mocks.update, delete: mocks.remove } } }));
vi.mock("@/src/modules/roles/role-permission.service", () => ({ requireTenantUserPermission: mocks.permission }));
import { createTag, createTagSchema, updateTagSchema, listTags, getTag, updateTag, deleteTag } from "@/src/modules/tenants/tag.service";
import type { SessionPayload } from "@/src/lib/auth/session";
const session = { audience: "TENANT_APP", role: "EDITOR", tenantId: "tenant-a", userId: "user-a" } as SessionPayload;
const id = "00000000-0000-4000-8000-000000000001";
const row = { uuid: id, name: "AI", slug: "ai", translations: [], createdAt: new Date(), updatedAt: new Date() };
beforeEach(() => { vi.resetAllMocks(); mocks.tenant.mockResolvedValue({ uuid: "tenant-a" }); mocks.list.mockResolvedValue([]); mocks.create.mockResolvedValue(row); mocks.update.mockResolvedValue(row); });
describe("tag validation", () => {
  it("allows no translations and normalizes names, slugs and locales", () => {
    expect(createTagSchema.parse({ name: " AI ", slug: " AI " })).toEqual({ name: "AI", slug: "ai", translations: [] });
    expect(createTagSchema.parse({ name: "AI", slug: "ai", translations: [{ locale: " KM ", name: " ខ្មែរ " }, { locale: "Zh", name: "人工智能" }] }).translations.map(item => item.locale)).toEqual(["km", "zh"]);
  });
  it.each([
    { name: " ", slug: "ai" }, { name: "AI", slug: "bad slug" },
    { name: "AI", slug: "ai", translations: [{ locale: "EN", name: "AI" }] },
    { name: "AI", slug: "ai", translations: [{ locale: "km", name: " " }] },
    { name: "AI", slug: "ai", translations: [{ locale: "km", name: "a" }, { locale: "KM", name: "b" }] },
  ])("rejects invalid input %j", input => { expect(createTagSchema.safeParse(input).success).toBe(false); });
  it("distinguishes omitted translations from removal", () => {
    expect(updateTagSchema.parse({ name: "AI" }).translations).toBeUndefined();
    expect(updateTagSchema.parse({ translations: [] }).translations).toEqual([]);
  });
});
describe("tag tenant isolation and permissions", () => {
  it("scopes all search branches and bounds the projection", async () => {
    await listTags(session, "AI", 2, 25);
    expect(mocks.permission).toHaveBeenCalledWith(session, "TAG_VIEW");
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantUuid: "tenant-a", OR: expect.arrayContaining([expect.objectContaining({ name: expect.any(Object) }), expect.objectContaining({ slug: expect.any(Object) }), expect.objectContaining({ translations: expect.any(Object) })]) }), select: expect.objectContaining({ uuid: true }), take: 25, skip: 25 }));
    await expect(listTags(session, null, 1, 101)).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
  });
  it("returns null for absent or other-tenant IDs", async () => {
    mocks.get.mockResolvedValue(null);
    expect(await getTag(session, id)).toBeNull();
    expect(mocks.get).toHaveBeenCalledWith(expect.objectContaining({ where: { uuid: id, tenantUuid: "tenant-a" } }));
  });
  it("uses session ownership on create and scoped atomic updates/deletes", async () => {
    await createTag(session, { name: "AI", slug: "ai", tenantUuid: "tenant-b" });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantUuid: "tenant-a" }) }));
    await updateTag(session, id, { translations: [] });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { uuid: id, tenantUuid: "tenant-a" }, data: expect.objectContaining({ translations: { deleteMany: {}, create: [] } }) }));
    await deleteTag(session, id);
    expect(mocks.remove).toHaveBeenCalledWith({ where: { uuid: id, tenantUuid: "tenant-a" } });
  });
  it.each(["TAG_VIEW", "TAG_CREATE", "TAG_EDIT", "TAG_DELETE"])("enforces %s independently", async permission => {
    mocks.permission.mockRejectedValue(new Error("Forbidden"));
    const action = permission === "TAG_VIEW" ? listTags(session) : permission === "TAG_CREATE" ? createTag(session, { name: "AI", slug: "ai" }) : permission === "TAG_EDIT" ? updateTag(session, id, {}) : deleteTag(session, id);
    await expect(action).rejects.toThrow("Forbidden");
    expect(mocks.permission).toHaveBeenCalledWith(session, permission);
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("rejects main console sessions", async () => { await expect(listTags({ ...session, audience: "ADMIN_CONSOLE" })).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } }); });
  it("maps duplicate slugs without swallowing unrelated errors", async () => {
    mocks.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "6" }));
    await expect(createTag(session, { name: "AI", slug: "ai" })).rejects.toThrow("A tag with this slug already exists");
    mocks.create.mockRejectedValue(new Error("database unavailable"));
    await expect(createTag(session, { name: "AI", slug: "ai" })).rejects.toThrow("database unavailable");
  });
});
