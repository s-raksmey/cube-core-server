import { describe, expect, it } from "vitest";
import { createSubTenant, getSubTenant } from "@/src/modules/tenants/tenant.service";
import { createAdminUser } from "@/src/modules/tenants/tenant-user-management.service";
import type { SessionPayload } from "@/src/lib/auth/session";

const adminSession = {
  userId: "user-1",
  tenantId: "tenant-1",
  role: "ADMIN",
} as SessionPayload;

describe("tenant management authorization and validation", () => {
  it("rejects tenant creation by a non-SuperAdmin before database access", async () => {
    await expect(
      createSubTenant(adminSession, { name: "New Tenant", slug: "new-tenant" }),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });

  it("rejects tenant detail access by a non-SuperAdmin before database access", async () => {
    await expect(getSubTenant(adminSession, "tenant-2")).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" },
    });
  });

  it("rejects roles outside ADMIN and EDITOR at the service boundary", async () => {
    await expect(
      createAdminUser(adminSession, {
        email: "editor@example.com",
        firstName: "Test",
        lastName: "User",
        role: "AUTHOR" as "ADMIN",
      }),
    ).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
  });
});
