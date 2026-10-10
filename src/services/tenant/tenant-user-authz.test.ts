import { describe, expect, it } from "vitest";

/**
 * Documents the permission matrix for sub-tenant user management.
 * Server enforcement lives in createAdminUser / listTenantUsers.
 */
describe("sub-tenant user management matrix", () => {
  const canInviteUsers = (role: string) =>
    role === "ADMIN" || role === "SUPERADMIN";
  const canListUsers = (role: string) =>
    role === "ADMIN" ||
    role === "EDITOR" ||
    role === "SUPERADMIN";
  const allowedInviteRoles = ["ADMIN", "EDITOR"] as const;

  it("only Admin (and SuperAdmin remote) may invite users", () => {
    expect(canInviteUsers("ADMIN")).toBe(true);
    expect(canInviteUsers("EDITOR")).toBe(false);
    expect(canInviteUsers("AUTHOR")).toBe(false);
  });

  it("Editor may list but not invite", () => {
    expect(canListUsers("EDITOR")).toBe(true);
    expect(canInviteUsers("EDITOR")).toBe(false);
  });

  it("invite roles are only ADMIN and EDITOR", () => {
    expect(allowedInviteRoles).toEqual(["ADMIN", "EDITOR"]);
    expect(allowedInviteRoles).not.toContain("SUPERADMIN");
  });
});
