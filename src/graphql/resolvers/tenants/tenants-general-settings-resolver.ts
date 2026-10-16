import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import {
  getMyGeneralSettings,
  getMyWebsiteSettings,
  getPublicGeneralSettings,
  updateMyGeneralSettings,
  updateMyWebsiteSettings,
} from "@/src/modules/tenants/tenant-general-settings.service";
import { listMySocialLinks, updateMySocialLinks } from "@/src/modules/tenants/tenant-social-links.service";
import { getMySeoSettings, updateMySeoImage, updateMySeoSettings } from "@/src/modules/tenants/tenant-seo-settings.service";
import { getMyContentSettings, updateMyContentSettings } from "@/src/modules/tenants/tenant-content-settings.service";

export const tenantsGeneralSettingsResolver = {
  Query: {
    myGeneralSettings: (_: unknown, _args: unknown, context: GraphQLContext) =>
      getMyGeneralSettings(requireSession(context)),
    myWebsiteSettings: (_: unknown, _args: unknown, context: GraphQLContext) =>
      getMyWebsiteSettings(requireSession(context)),
    mySocialLinks: (_: unknown, _args: unknown, context: GraphQLContext) =>
      listMySocialLinks(requireSession(context)),
    mySeoSettings: (_: unknown, _args: unknown, context: GraphQLContext) =>
      getMySeoSettings(requireSession(context)),
    myContentSettings: (_: unknown, _args: unknown, context: GraphQLContext) =>
      getMyContentSettings(requireSession(context)),
    publicGeneralSettings: (_: unknown, args: { hostname: string }) =>
      getPublicGeneralSettings(args.hostname),
  },
  Mutation: {
    updateMyGeneralSettings: (_: unknown, args: { input: unknown }, context: GraphQLContext) =>
      updateMyGeneralSettings(requireSession(context), args.input),
    updateMyWebsiteSettings: (_: unknown, args: { input: unknown }, context: GraphQLContext) =>
      updateMyWebsiteSettings(requireSession(context), args.input),
    updateMySocialLinks: (_: unknown, args: { input: unknown }, context: GraphQLContext) =>
      updateMySocialLinks(requireSession(context), args.input),
    updateMySeoSettings: (_: unknown, args: { input: unknown }, context: GraphQLContext) =>
      updateMySeoSettings(requireSession(context), args.input),
    updateMySeoImage: (_: unknown, args: { input: unknown }, context: GraphQLContext) =>
      updateMySeoImage(requireSession(context), args.input),
    updateMyContentSettings: (_: unknown, args: { input: unknown }, context: GraphQLContext) =>
      updateMyContentSettings(requireSession(context), args.input),
  },
  PublicGeneralSettings: { tenantId: (parent: { tenantUuid: string }) => parent.tenantUuid },
};
