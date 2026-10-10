import { afterEach, describe, expect, it, vi } from "vitest";
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
