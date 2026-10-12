import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(),
  upsert: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/src/lib/db", () => ({
  prisma: {
    localDevelopmentTenant: {
      findUnique: mocks.findUnique,
    },
  },
}));

import {
  LOCAL_DEVELOPMENT_HOSTNAME,
  findLocalDevelopmentTenant,
  setLocalDevelopmentAssignment,
} from "@/src/modules/tenants/local-development-tenant.service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deleteMany.mockResolvedValue({ count: 1 });
  mocks.upsert.mockResolvedValue({ hostname: LOCAL_DEVELOPMENT_HOSTNAME });
});

afterEach(() => vi.unstubAllEnvs());

describe("local development tenant assignment", () => {
  const tx = {
    localDevelopmentTenant: {
      deleteMany: mocks.deleteMany,
      upsert: mocks.upsert,
    },
  } as never;

  it("assigns localhost to the selected tenant with one atomic upsert", async () => {
    await setLocalDevelopmentAssignment(tx, "tenant-new", "localhost");
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { hostname: "localhost" },
      create: { hostname: "localhost", tenantUuid: "tenant-new" },
      update: { tenantUuid: "tenant-new" },
      select: { hostname: true },
    });
  });

  it("moves localhost to a new tenant by updating the singleton assignment", async () => {
    await setLocalDevelopmentAssignment(tx, "tenant-other", "localhost");
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { tenantUuid: "tenant-other" } }),
    );
  });

  it("clears only the selected tenant assignment", async () => {
    await setLocalDevelopmentAssignment(tx, "tenant-old", null);
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { tenantUuid: "tenant-old" },
    });
  });

  it("returns an active SUB tenant as the shared local routing target", async () => {
    mocks.findUnique.mockResolvedValue({
      tenant: {
        uuid: "tenant-one",
        name: "Tenant One",
        slug: "tenant-one",
        type: "SUB",
        status: "ACTIVE",
        deletedAt: null,
      },
    });
    await expect(findLocalDevelopmentTenant()).resolves.toMatchObject({
      uuid: "tenant-one",
      name: "Tenant One",
    });
  });

  it("does not expose local routing in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(findLocalDevelopmentTenant()).resolves.toBeNull();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});
