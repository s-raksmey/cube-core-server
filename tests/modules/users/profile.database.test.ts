import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { createYoga } from "graphql-yoga";
import { schema } from "@/src/graphql/resolvers";
import { prisma } from "@/src/lib/db";
import type { SessionPayload } from "@/src/lib/auth/session";
import { getProfile, updateMyProfile } from "@/src/modules/users/profile.service";
import { removeProfileImage } from "@/src/modules/users/profile-image.service";

const suite = process.env.RUN_PROFILE_DATABASE_TESTS === "1" ? describe.sequential : describe.skip;
suite("profile database and image integration", () => {
  const tenantId = randomUUID(), otherTenant = randomUUID(), userId = randomUUID();
  const session: SessionPayload = { userId, tenantId, role: "EDITOR", audience: "TENANT_APP", sessionId: randomUUID() };
  const input = { firstName: "Updated", lastName: "Profile", username: `profile-${randomUUID().replaceAll("-", "")}` };
  const images: string[] = [];
  beforeAll(async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: "EDITOR" } });
    await prisma.tenant.createMany({ data: [tenantId, otherTenant].map((uuid) => ({ uuid, slug: `profile-${uuid}`, name: "Profile test", type: "SUB", status: "ACTIVE" })) });
    await prisma.user.create({ data: { uuid: userId, firstName: "Before", lastName: "Profile", email: `${userId}@example.test`, status: "ACTIVE" } });
    await prisma.tenantMembership.create({ data: { userUuid: userId, tenantUuid: tenantId, roleUuid: role.uuid } });
  });
  afterAll(async () => {
    for (const image of images) await removeProfileImage(userId, image);
    await prisma.tenant.deleteMany({ where: { uuid: { in: [tenantId, otherTenant] } } });
    await prisma.user.deleteMany({ where: { uuid: userId } });
    await prisma.$disconnect();
  });
  it("saves names and a real normalized avatar, reloads them, and removes the photo", async () => {
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#3867fa" } }).png().toBuffer();
    await updateMyProfile(session, { ...input, image: { fileName: "photo.png", mimeType: "image/png", contentBase64: png.toString("base64") } });
    const profile = await getProfile(userId, tenantId);
    expect(profile).toMatchObject({ fullName: "Updated Profile", username: input.username });
    expect(profile?.avatarUrl).toMatch(new RegExp(`^/storage/users/${userId}/avatars/.*\\.webp$`));
    images.push(profile!.avatarUrl!);
    const saved = await readFile(resolve(process.env.LOCAL_STORAGE_PATH ?? "storage", profile!.avatarUrl!.slice("/storage/".length)));
    const metadata = await sharp(saved).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: 256, height: 256 });
    expect(metadata.exif).toBeUndefined();
    await updateMyProfile(session, { ...input, removeImage: true });
    expect((await getProfile(userId, tenantId))?.avatarUrl).toBeNull();
  });
  it("exposes the mutation and refreshed profile through the real GraphQL schema", async () => {
    async function execute(source: string, variables = {}, actor: SessionPayload | null = session) {
      const api = createYoga({ schema, maskedErrors: false, logging: false, context: () => ({ session: actor, tenantHostMismatch: false }) });
      const response = await api.fetch(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: source, variables }) }));
      return response.json() as Promise<{ data?: Record<string, unknown>; errors?: { extensions?: { code?: string } }[] }>;
    }
    const result = await execute("mutation Save($input: UpdateMyProfileInput!) { updateMyProfile(input: $input) { id firstName lastName fullName avatarUrl } }", { input });
    expect(result.errors).toBeUndefined();
    expect(result.data?.updateMyProfile).toMatchObject({ id: userId, fullName: "Updated Profile", avatarUrl: null });
    const me = await execute("{ me { id fullName avatarUrl } }");
    expect(me.errors).toBeUndefined();
    expect(me.data?.me).toMatchObject({ id: userId, fullName: "Updated Profile" });
    const denied = await execute("mutation Save($input: UpdateMyProfileInput!) { updateMyProfile(input: $input) { id } }", { input }, null);
    expect(denied.errors?.[0].extensions?.code).toBe("UNAUTHENTICATED");
  });
  it("rejects another tenant and spoofed image content", async () => {
    await expect(updateMyProfile({ ...session, tenantId: otherTenant }, input)).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    await expect(updateMyProfile(session, { ...input, image: { fileName: "photo.png", mimeType: "image/png", contentBase64: Buffer.from("not an image").toString("base64") } })).rejects.toMatchObject({ extensions: { code: "VALIDATION" } });
    expect((await getProfile(userId, tenantId))?.avatarUrl).toBeNull();
  });
});
