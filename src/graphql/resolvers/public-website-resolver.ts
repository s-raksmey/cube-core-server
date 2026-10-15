import {
  publicWebsiteArticle,
  publicWebsiteArticles,
  publicWebsiteCategories,
  publicWebsitePopularArticles,
  publicWebsiteRelatedArticles,
  publicWebsiteTags,
} from "@/src/modules/articles/public-article.service";
import { recordPublicWebsiteArticleView } from "@/src/modules/articles/public-article-view.service";
import { recordPublicWebsiteArticleShare } from "@/src/modules/articles/public-article-share.service";

export const publicWebsiteResolver = {
  Query: {
    publicWebsiteCategories: (_: unknown, args: { tenantId: string }) => publicWebsiteCategories(args.tenantId),
    publicWebsiteTags: (_: unknown, args: { tenantId: string }) => publicWebsiteTags(args.tenantId),
    publicWebsiteArticles: (_: unknown, args: { tenantId: string; categorySlug?: string | null; subcategorySlug?: string | null; tagSlug?: string | null;
      search?: string | null; featured?: boolean | null; breaking?: boolean | null; page?: number; pageSize?: number }) =>
      publicWebsiteArticles(args.tenantId, args),
    publicWebsiteArticle: (_: unknown, args: { tenantId: string; slug: string }) => publicWebsiteArticle(args.tenantId, args.slug),
    publicWebsiteRelatedArticles: (_: unknown, args: { tenantId: string; slug: string; limit?: number }) =>
      publicWebsiteRelatedArticles(args.tenantId, args.slug, args.limit),
    publicWebsitePopularArticles: (_: unknown, args: { tenantId: string; limit?: number }) =>
      publicWebsitePopularArticles(args.tenantId, args.limit),
  },
  Mutation: {
    recordPublicWebsiteArticleView: (_: unknown, args: { hostname: string; articleId: string; visitorId: string }) =>
      recordPublicWebsiteArticleView(args),
    recordPublicWebsiteArticleShare: (_: unknown, args: { hostname: string; articleId: string; visitorId: string; platform: string }) =>
      recordPublicWebsiteArticleShare(args),
  },
};
