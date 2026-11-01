import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { SessionPayload } from "@/src/lib/auth/session";

const mocks = vi.hoisted(() => ({ membership: vi.fn(), update: vi.fn(), save: vi.fn(), remove: vi.fn(), audit: vi.fn() }));
vi.mock("@/src/lib/db", () => ({ prisma: {
  tenantMembership: { findFirst: mocks.membership },
  $transaction: (run: (tx: unknown) => unknown) => run({ user: { update: mocks.update } }),
} }));
vi.mock("@/src/modules/users/profile-image.service", () => ({ saveProfileImage: mocks.save, removeProfileImage: mocks.remove }));
vi.mock("@/src/modules/auth/audit-auth", () => ({ writeAuthAudit: mocks.audit }));
import { getProfile, updateMyProfile, profileInputSchema } from "@/src/modules/users/profile.service";

const session: SessionPayload = { userId: "self", tenantId: "tenant", role: "EDITOR", audience: "TENANT_APP", sessionId: "session" };
const input = { firstName: " First ", lastName: " Last ", username: " New.User " };
const image = { fileName: "photo.png", mimeType: "image/png", contentBase64: "AAAA" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.membership.mockResolvedValue({ status: "ACTIVE", role: { code: "EDITOR" }, tenant: { uuid: "tenant", name: "Tenant", slug: "tenant", type: "SUB", status: "ACTIVE" }, user: { uuid: "self", firstName: "First", lastName: "Last", email: "user@example.test", username: "user", avatarPath: "/old.webp", status: "ACTIVE" } });
  mocks.save.mockResolvedValue("/new.webp"); mocks.remove.mockResolvedValue(undefined);
});
describe("self profile updates", () => {
  it.each(["ADMIN", "EDITOR"])("lets %s update only the authenticated user", async (role) => {
    await updateMyProfile({ ...session, role }, input);
    expect(mocks.membership.mock.calls[0][0].where).toMatchObject({ userUuid: "self", tenantUuid: "tenant", role: { code: role }, tenant: { type: "SUB", status: "ACTIVE" } });
    expect(mocks.update).toHaveBeenCalledWith({ where: { uuid: "self" }, data: { firstName: "First", lastName: "Last", username: "new.user" }, select: { uuid: true } });
  });
  it("allows Main SuperAdmin access only with a MAIN membership", async () => {
    await updateMyProfile({ ...session, role: "SUPERADMIN", audience: "ADMIN_CONSOLE" }, input);
    expect(mocks.membership.mock.calls[0][0].where.tenant.type).toBe("MAIN");
  });
  it("rejects target IDs, email changes, roles and credential fields", () => {
    for (const field of ["userId", "tenantId", "email", "role", "passwordHash"]) expect(profileInputSchema.safeParse({ ...input, [field]: "other" }).success).toBe(false);
  });
  it.each([
    { ...session, role: "SUPERADMIN" }, { ...session, audience: "ADMIN_CONSOLE" as const },
  ])("rejects an audience/role mismatch", async (actor) => {
    await expect(updateMyProfile(actor, input)).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects inactive, removed or cross-tenant membership before accepting a file", async () => {
    mocks.membership.mockResolvedValue(null);
    await expect(updateMyProfile(session, { ...input, image })).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("persists the new image then removes the old owned file", async () => {
    await updateMyProfile(session, { ...input, image });
    expect(mocks.save).toHaveBeenCalledWith("self", image);
    expect(mocks.update.mock.calls[0][0].data.avatarPath).toBe("/new.webp");
    expect(mocks.remove).toHaveBeenCalledWith("self", "/old.webp");
  });
  it("cleans up a newly uploaded file when the transaction fails", async () => {
    mocks.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Duplicate", { code: "P2002", clientVersion: "6" }));
    await expect(updateMyProfile(session, { ...input, image })).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    expect(mocks.remove).toHaveBeenCalledWith("self", "/new.webp");
    expect(mocks.remove).not.toHaveBeenCalledWith("self", "/old.webp");
  });
  it("removes an image without changing any other account's image", async () => {
    await updateMyProfile(session, { ...input, removeImage: true });
    expect(mocks.update.mock.calls[0][0].data.avatarPath).toBeNull();
    expect(mocks.remove).toHaveBeenCalledWith("self", "/old.webp");
  });
  it("rejects conflicting image actions and blank names", () => {
    expect(profileInputSchema.safeParse({ ...input, image, removeImage: true }).success).toBe(false);
    expect(profileInputSchema.safeParse({ ...input, firstName: " " }).success).toBe(false);
  });
  it("reads only safe fields for session display", async () => {
    mocks.membership.mockResolvedValue(null);
    await getProfile("self", "tenant");
    const query = mocks.membership.mock.calls[0][0];
    expect(query.where).toMatchObject({ userUuid: "self", tenantUuid: "tenant", status: "ACTIVE" });
    expect(query.include).toBeUndefined();
    for (const key of ["passwordHash", "twoFactorAuth", "recoveryCodes", "activationTokens"]) expect(JSON.stringify(query.select)).not.toContain(key);
  });
});
