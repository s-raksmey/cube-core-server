import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSchema } from "graphql-yoga";
import { TenantStatus } from "@prisma/client";
import type { GraphQLContext } from "@/src/graphql/context";
import { login, getMe } from "@/src/modules/auth/auth.service";
import {
  getPlatformDashboard,
  getTenantDashboard,
} from "@/src/modules/dashboard/dashboard.service";
import {
  createAdminUser,
  createSubTenant,
  listSubTenants,
  setSubTenantStatus,
} from "@/src/modules/tenants/tenant.service";
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
    Tenant: {
      createdAt: (parent: { createdAt: Date | string }) => toIso(parent.createdAt),
    },
    User: {
      createdAt: (parent: { createdAt?: Date | string | null }) =>
        parent.createdAt ? toIso(parent.createdAt) : null,
    },
    ActivityItem: {
      createdAt: (parent: { createdAt: Date | string }) => toIso(parent.createdAt),
    },
    Query: {
      me: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
        if (!ctx.session) return null;
        return getMe(ctx.session.userId);
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
        return login(args.email, args.password, args.audience ?? "ADMIN_CONSOLE");
      },
      logout: async () => true,
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
        args: { email: string; password: string; tenantId: string },
        ctx: GraphQLContext,
      ) => {
        return createAdminUser(requireSession(ctx), args);
      },
    },
  },
});
