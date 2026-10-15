import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findActiveTenantById: vi.fn(),
  categoryFindMany: vi.fn(),
}));

vi.mock("@/src/modules/tenants/tenant-domain.service", () => ({
  findActiveTenantById: mocks.findActiveTenantById,
}));
vi.mock("@/src/lib/db", () => ({
  prisma: { category: { findMany: mocks.categoryFindMany } },
}));

import { publicWebsiteCategories } from "@/src/modules/articles/public-article.service";

const tenantId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findActiveTenantById.mockResolvedValue({ uuid: tenantId });
});

describe("public category navigation", () => {
  it("includes configured categories and subcategories without published articles", async () => {
    mocks.categoryFindMany.mockResolvedValue([{ uuid: "category-1", slug: "news", name: "News",
      translations: [{ locale: "en", name: "News" }],
      subcategories: [{ slug: "local", translations: [{ locale: "en", name: "Local" }] }],
    }]);

    await expect(publicWebsiteCategories(tenantId)).resolves.toEqual([{ id: "category-1", slug: "news", name: "News",
      translations: [{ locale: "en", name: "News" }],
      subcategories: [{ slug: "local", translations: [{ locale: "en", name: "Local" }] }],
    }]);
    expect(mocks.categoryFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantUuid: tenantId },
      select: expect.objectContaining({
        uuid: true, slug: true, name: true,
        subcategories: expect.objectContaining({ select: expect.objectContaining({ slug: true }) }),
      }),
    }));
  });

  it("does not read categories for an inactive tenant", async () => {
    mocks.findActiveTenantById.mockResolvedValue(null);
    await expect(publicWebsiteCategories(tenantId)).resolves.toEqual([]);
    expect(mocks.categoryFindMany).not.toHaveBeenCalled();
  });
});
