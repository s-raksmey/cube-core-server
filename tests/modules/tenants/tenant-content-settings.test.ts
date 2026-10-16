import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/src/lib/auth/session";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn(), permission: vi.fn(), lock: vi.fn() }));
vi.mock("@/src/lib/db", () => ({ prisma: { tenant: { findFirst: mocks.findFirst, updateMany: mocks.updateMany },
  $transaction: (work: (tx: unknown) => Promise<unknown>) => work({ tenant: { findFirst: mocks.findFirst, updateMany: mocks.updateMany }, $queryRaw: mocks.lock }),
} }));
vi.mock("@/src/modules/roles/role-permission.service", () => ({ requireTenantUserPermission: mocks.permission }));

import { breakingExpiresAt, contentSettingsFromJson, getMyContentSettings, updateMyContentSettings } from "@/src/modules/tenants/tenant-content-settings.service";

const session = { audience: "TENANT_APP", tenantId: "tenant-a", userId: "user-a" } as SessionPayload;
const start = new Date("2026-10-16T10:00:00.000Z");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findFirst.mockResolvedValue({ settings: {} });
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe("tenant Breaking duration settings", () => {
  it("defaults existing tenants to 24 hours", async () => {
    expect(await getMyContentSettings(session)).toEqual({ breakingDurationValue: 24, breakingDurationUnit: "HOURS" });
    expect(breakingExpiresAt(start, {})).toEqual(new Date("2026-10-17T10:00:00.000Z"));
    expect(mocks.permission).toHaveBeenCalledWith(session, "SETTINGS_VIEW");
  });

  it("updates only the authenticated tenant while preserving other settings", async () => {
    mocks.findFirst.mockResolvedValue({ settings: { general: { siteName: "Site A" } } });
    const input = { breakingDurationValue: 2, breakingDurationUnit: "DAYS" };
    expect(await updateMyContentSettings(session, input)).toEqual(input);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ uuid: "tenant-a", type: "SUB" }),
      data: { settings: { general: { siteName: "Site A" }, content: input } },
    });
    expect(breakingExpiresAt(start, { content: input })).toEqual(new Date("2026-10-18T10:00:00.000Z"));
    expect(mocks.permission).toHaveBeenCalledWith(session, "SETTINGS_UPDATE");
  });

  it("does not recalculate an already published article when the default changes", () => {
    const existing = breakingExpiresAt(start, {});
    const changed = { content: { breakingDurationValue: 3, breakingDurationUnit: "DAYS" } };
    expect(existing).toEqual(new Date("2026-10-17T10:00:00.000Z"));
    expect(breakingExpiresAt(start, changed)).toEqual(new Date("2026-10-19T10:00:00.000Z"));
    expect(existing).toEqual(new Date("2026-10-17T10:00:00.000Z"));
  });

  it("rejects invalid, excessive, or cross-tenant input", async () => {
    for (const input of [
      { breakingDurationValue: 0, breakingDurationUnit: "HOURS" },
      { breakingDurationValue: 31, breakingDurationUnit: "DAYS" },
      { breakingDurationValue: 1, breakingDurationUnit: "WEEKS" },
      { breakingDurationValue: 24, breakingDurationUnit: "HOURS", tenantUuid: "tenant-b" },
    ]) await expect(updateMyContentSettings(session, input)).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(contentSettingsFromJson({ content: { breakingDurationValue: -1, breakingDurationUnit: "HOURS" } }))
      .toEqual({ breakingDurationValue: 24, breakingDurationUnit: "HOURS" });
  });

  it("denies updates without Settings permission", async () => {
    mocks.permission.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(updateMyContentSettings(session, { breakingDurationValue: 24, breakingDurationUnit: "HOURS" }))
      .rejects.toThrow("Forbidden");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
