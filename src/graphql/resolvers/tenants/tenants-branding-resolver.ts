import { requireSession } from "@/src/graphql/helpers";
import type { GraphQLContext } from "@/src/graphql/context";
import { getMainTenantBranding, getMyTenantBranding, getTenantBranding, updateMainTenantBranding, updateTenantBranding, type BrandingAsset } from "@/src/modules/tenants/tenant-branding.service";

export const tenantsBrandingResolver = {
  Query: {
    tenantBranding: (_: unknown, args: { tenantId: string }, ctx: GraphQLContext) => getTenantBranding(requireSession(ctx), args.tenantId),
    myTenantBranding: (_: unknown, __: unknown, ctx: GraphQLContext) => getMyTenantBranding(requireSession(ctx)),
    mainTenantBranding: (_: unknown, __: unknown, ctx: GraphQLContext) => getMainTenantBranding(requireSession(ctx)),
  },
  Mutation: {
    updateTenantBranding: (_: unknown, args: { tenantId: string; asset: BrandingAsset; fileName: string; mimeType: string; contentBase64?: string | null }, ctx: GraphQLContext) => updateTenantBranding(requireSession(ctx), args.tenantId, args),
    updateMyTenantBranding: (_: unknown, args: { asset: BrandingAsset; fileName: string; mimeType: string; contentBase64?: string | null }, ctx: GraphQLContext) => updateTenantBranding(requireSession(ctx), requireSession(ctx).tenantId, args, true),
    updateMainTenantBranding: (_: unknown, args: { asset: BrandingAsset; fileName: string; mimeType: string; contentBase64?: string | null }, ctx: GraphQLContext) => updateMainTenantBranding(requireSession(ctx), args),
  },
};
