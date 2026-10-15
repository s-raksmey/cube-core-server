import {
  publicWebsiteArticle,
  publicWebsiteArticles,
  publicWebsiteCategories,
  publicWebsiteTags,
} from "@/src/modules/articles/public-article.service";

export const publicWebsiteResolver = {
  Query: {
    publicWebsiteCategories: (_: unknown, args: { tenantId: string }) => publicWebsiteCategories(args.tenantId),
    publicWebsiteTags: (_: unknown, args: { tenantId: string }) => publicWebsiteTags(args.tenantId),
    publicWebsiteArticles: (_: unknown, args: { tenantId: string; categorySlug?: string | null; subcategorySlug?: string | null; tagSlug?: string | null;
      search?: string | null; featured?: boolean | null; breaking?: boolean | null; page?: number; pageSize?: number }) =>
      publicWebsiteArticles(args.tenantId, args),
    publicWebsiteArticle: (_: unknown, args: { tenantId: string; slug: string }) => publicWebsiteArticle(args.tenantId, args.slug),
  },
};
