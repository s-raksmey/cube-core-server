import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSchema } from "graphql-yoga";
import { TenantStatus, UserStatus } from "@prisma/client";
import type { GraphQLContext } from "@/src/graphql/context";
import { loginWithPassword, getMe } from "@/src/modules/auth/auth.service";
import {
  verifyLoginTotp,
  verifyTotpEnrollment,
} from "@/src/modules/auth/totp.service";
import {
  generateMainTenantUserPasswordResetLink,
  generateSubTenantUserPasswordResetLink,
} from "@/src/modules/auth/password-reset.service";
import {
  getPlatformDashboard,
  getTenantDashboard,
} from "@/src/modules/dashboard/dashboard.service";
import {
  createAdminUser,
  createSubTenant,
  listSubTenants,
  listTenantUsers,
  setSubTenantStatus,
} from "@/src/modules/tenants/tenant.service";
import {
  createMainTenantUser,
  deleteMainTenantUser,
  generateMainTenantUserActivationLink,
  getMainTenantUser,
  listMainTenantUsers,
  updateMainTenantUser,
} from "@/src/modules/users/main-users.service";
import { revokeSessionById } from "@/src/modules/auth/session.service";
import { unauthenticated } from "@/src/lib/errors";

const typeDefs = readFileSync(
  join(process.cwd(), "src/graphql/schema.graphql"),
  "utf8",
);

function requireSession(ctx: GraphQLContext) {
  if (!ctx.session) {
    throw unauthenticated();
  }
  return ctx.session;
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

export const schema = createSchema({
  typeDefs,
  resolvers: {
    LoginResult: {
      __resolveType(value: { challengeToken?: string; accessToken?: string }) {
        if (value.challengeToken) return "AuthChallenge";
        if (value.accessToken) return "AuthPayload";
        return null;
      },
    },
    Tenant: {
      id: (parent: { id?: string; uuid?: string }) => parent.id ?? parent.uuid,
      createdAt: (parent: { createdAt: Date | string }) => toIso(parent.createdAt),
    },
    User: {
      id: (parent: { id?: string; uuid?: string }) => parent.id ?? parent.uuid,
      createdAt: (parent: { createdAt?: Date | string | null }) =>
        parent.createdAt ? toIso(parent.createdAt) : null,
    },
    ActivityItem: {
      createdAt: (parent: { createdAt: Date | string }) => toIso(parent.createdAt),
    },
    Query: {
      me: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
        if (!ctx.session) return null;
        return getMe(ctx.session.userId, ctx.session.tenantId);
      },
      platformDashboard: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
        return getPlatformDashboard(requireSession(ctx));
      },
      tenantDashboard: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
        return getTenantDashboard(requireSession(ctx));
      },
      subTenants: async (
        _: unknown,
        args: { search?: string; page?: number; pageSize?: number },
        ctx: GraphQLContext,
      ) => {
        return listSubTenants(requireSession(ctx), args);
      },
      mainTenantUsers: async (
        _: unknown,
        args: { search?: string; page?: number; pageSize?: number },
        ctx: GraphQLContext,
      ) => {
        return listMainTenantUsers(requireSession(ctx), args);
      },
      mainTenantUser: async (
        _: unknown,
        args: { id: string },
        ctx: GraphQLContext,
      ) => {
        return getMainTenantUser(requireSession(ctx), args.id);
      },
      tenantUsers: async (
        _: unknown,
        args: { search?: string; page?: number; pageSize?: number },
        ctx: GraphQLContext,
      ) => {
        return listTenantUsers(requireSession(ctx), args);
      },
    },
    Mutation: {
      login: async (
        _: unknown,
        args: {
          email: string;
          password: string;
          audience?: "ADMIN_CONSOLE" | "TENANT_APP";
        },
      ) => {
        const result = await loginWithPassword(
          args.email,
          args.password,
          args.audience ?? "ADMIN_CONSOLE",
        );
        if (result.status === "CHALLENGE") {
          return {
            challengeToken: result.challengeToken,
            nextStep: result.nextStep,
            qrCodeDataUrl: result.qrCodeDataUrl ?? null,
            manualEntryKey: result.manualEntryKey ?? null,
          };
        }
        throw unauthenticated("Unexpected login state");
      },
      verifyLoginTotp: async (
        _: unknown,
        args: { challengeToken: string; code: string },
      ) => {
        const result = await verifyLoginTotp(args);
        return {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          audience: result.audience,
          user: result.user,
        };
      },
      verifyTotpEnrollment: async (
        _: unknown,
        args: { challengeToken: string; code: string },
      ) => {
        const result = await verifyTotpEnrollment(args);
        return {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          audience: result.audience,
          user: result.user,
        };
      },
      generatePasswordResetLink: async (
        _: unknown,
        args: { userId: string },
        ctx: GraphQLContext,
      ) => {
        return generateSubTenantUserPasswordResetLink(
          requireSession(ctx),
          args.userId,
        );
      },
      logout: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
        if (ctx.session) {
          await revokeSessionById(ctx.session.sessionId);
        }
        return true;
      },
      createSubTenant: async (
        _: unknown,
        args: { name: string; slug: string },
        ctx: GraphQLContext,
      ) => {
        return createSubTenant(requireSession(ctx), args);
      },
      setSubTenantStatus: async (
        _: unknown,
        args: { tenantId: string; status: TenantStatus },
        ctx: GraphQLContext,
      ) => {
        return setSubTenantStatus(requireSession(ctx), args);
      },
      createAdminUser: async (
        _: unknown,
        args: {
          email: string;
          firstName: string;
          lastName: string;
          tenantId?: string | null;
          role?: "ADMIN" | "EDITOR" | "AUTHOR";
        },
        ctx: GraphQLContext,
      ) => {
        return createAdminUser(requireSession(ctx), {
          email: args.email,
          firstName: args.firstName,
          lastName: args.lastName,
          ...(args.tenantId ? { tenantId: args.tenantId } : {}),
          ...(args.role ? { role: args.role } : {}),
        });
      },
      createMainTenantUser: async (
        _: unknown,
        args: { firstName: string; lastName: string; email: string },
        ctx: GraphQLContext,
      ) => {
        return createMainTenantUser(requireSession(ctx), args);
      },
      updateMainTenantUser: async (
        _: unknown,
        args: {
          id: string;
          input: {
            firstName?: string | null;
            lastName?: string | null;
            email?: string | null;
            status?: UserStatus | null;
          };
        },
        ctx: GraphQLContext,
      ) => {
        return updateMainTenantUser(requireSession(ctx), args.id, {
          ...(args.input.firstName != null
            ? { firstName: args.input.firstName }
            : {}),
          ...(args.input.lastName != null
            ? { lastName: args.input.lastName }
            : {}),
          ...(args.input.email != null ? { email: args.input.email } : {}),
          ...(args.input.status != null ? { status: args.input.status } : {}),
        });
      },
      deleteMainTenantUser: async (
        _: unknown,
        args: { id: string },
        ctx: GraphQLContext,
      ) => {
        return deleteMainTenantUser(requireSession(ctx), args.id);
      },
      generateMainTenantUserPasswordResetLink: async (
        _: unknown,
        args: { userId: string },
        ctx: GraphQLContext,
      ) => {
        return generateMainTenantUserPasswordResetLink(
          requireSession(ctx),
          args.userId,
        );
      },
      generateMainTenantUserActivationLink: async (
        _: unknown,
        args: { userId: string },
        ctx: GraphQLContext,
      ) => {
        return generateMainTenantUserActivationLink(
          requireSession(ctx),
          args.userId,
        );
      },
    },
  },
});
