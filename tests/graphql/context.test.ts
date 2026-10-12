import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveSessionFromAccessToken: vi.fn(),
  findActiveTenantByHostname: vi.fn(),
}));
vi.mock("@/src/modules/auth/session.service", () => ({
  resolveSessionFromAccessToken: mocks.resolveSessionFromAccessToken,
}));
vi.mock("@/src/modules/tenants/tenant-domain.service", () => ({
  findActiveTenantByHostname: mocks.findActiveTenantByHostname,
}));

import { createContext } from "@/src/graphql/context";
import { requireTrustedAuthAction } from "@/src/graphql/helpers";

describe("trusted authentication caller", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts only a configured server secret and keeps audiences separate", async () => {
    vi.stubEnv("ADMIN_AUTH_ACTION_SECRET", "admin-secret-value");
    vi.stubEnv("TENANT_AUTH_ACTION_SECRET", "tenant-secret-value");

    const adminContext = await createContext({
      request: new Request("http://localhost/graphql", {
        headers: { "x-cube-auth-action-secret": "admin-secret-value" },
      }),
    } as Parameters<typeof createContext>[0]);
    expect(adminContext.trustedAuthAudience).toBe("ADMIN_CONSOLE");
    expect(() => requireTrustedAuthAction(adminContext, "ADMIN_CONSOLE")).not.toThrow();
    expect(() => requireTrustedAuthAction(adminContext, "TENANT_APP")).toThrow();

    const browserContext = await createContext({
      request: new Request("http://localhost/graphql"),
    } as Parameters<typeof createContext>[0]);
    expect(browserContext.trustedAuthAudience).toBeNull();
  });
});

describe("tenant console host binding", () => {
  it("rejects a valid session when its tenant differs from the management hostname", async () => {
    mocks.resolveSessionFromAccessToken.mockResolvedValue({ tenantId: "tenant-a" });
    mocks.findActiveTenantByHostname.mockResolvedValue({ uuid: "tenant-b" });

    const context = await createContext({
      request: new Request("https://tenant-b.example/graphql", {
        headers: {
          Authorization: "Bearer valid-session-token",
          "x-cube-tenant-management-host": "tenant-b.example",
        },
      }),
    } as Parameters<typeof createContext>[0]);

    expect(context.session).toBeNull();
    expect(context.tenantHostMismatch).toBe(true);
  });

  it("keeps the signed session when it matches the management hostname", async () => {
    const session = { tenantId: "tenant-a" };
    mocks.resolveSessionFromAccessToken.mockResolvedValue(session);
    mocks.findActiveTenantByHostname.mockResolvedValue({ uuid: "tenant-a" });

    const context = await createContext({
      request: new Request("https://tenant-a.example/graphql", {
        headers: {
          Authorization: "Bearer valid-session-token",
          "x-cube-tenant-management-host": "tenant-a.example",
        },
      }),
    } as Parameters<typeof createContext>[0]);

    expect(context.session).toBe(session);
    expect(context.tenantHostMismatch).toBe(false);
  });
});
