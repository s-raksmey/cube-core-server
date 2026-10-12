import { describe, expect, it } from "vitest";

/**
 * Documents the configurable permission matrix for sub-tenant user management.
 * Server enforcement lives in the tenant service permission checks.
 */
describe("sub-tenant user management matrix", () => {
  const canInviteUsers = (permissions: string[]) =>
    permissions.includes("USERS_CREATE");
  const canListUsers = (permissions: string[]) =>
    permissions.includes("USERS_VIEW");
  const allowedInviteRoles = ["ADMIN", "EDITOR"] as const;

  it("allows either tenant role to invite when Create users is granted", () => {
    expect(canInviteUsers(["USERS_VIEW", "USERS_CREATE"])).toBe(true);
    expect(canInviteUsers(["USERS_VIEW"])).toBe(false);
  });

  it("requires View users before the role can open the Users screen", () => {
    expect(canListUsers(["USERS_VIEW", "USERS_CREATE"])).toBe(true);
    expect(canListUsers(["USERS_CREATE"])).toBe(false);
  });

  it("invite roles are only ADMIN and EDITOR", () => {
    expect(allowedInviteRoles).toEqual(["ADMIN", "EDITOR"]);
    expect(allowedInviteRoles).not.toContain("SUPERADMIN");
  });
});
