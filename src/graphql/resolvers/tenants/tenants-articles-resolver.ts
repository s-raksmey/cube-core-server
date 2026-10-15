import type { GraphQLContext } from "@/src/graphql/context";
import { requireSession } from "@/src/graphql/helpers";
import * as articles from "@/src/modules/articles/article.service";

type ArticleArgs = { id: string };
type InputArgs = ArticleArgs & { input: unknown };
type DateArgs = ArticleArgs & { scheduledAt: string };
const session = (context: GraphQLContext) => requireSession(context);

export const tenantsArticlesResolver = {
  Query: {
    articles: (_: unknown, args: unknown, context: GraphQLContext) => articles.listArticles(session(context), args),
    article: (_: unknown, args: ArticleArgs, context: GraphQLContext) => articles.getArticle(session(context), args.id),
  },
  Mutation: {
    createArticle: (_: unknown, args: { input: unknown }, context: GraphQLContext) => articles.createArticle(session(context), args.input),
    uploadArticleImage: (_: unknown, args: { articleId?: string | null; input: unknown }, context: GraphQLContext) => articles.uploadArticleImage(session(context), args.articleId, args.input),
    updateArticle: (_: unknown, args: InputArgs, context: GraphQLContext) => articles.updateArticle(session(context), args.id, args.input),
    deleteArticle: (_: unknown, args: ArticleArgs, context: GraphQLContext) => articles.deleteArticle(session(context), args.id),
    deleteArchivedArticle: (_: unknown, args: ArticleArgs, context: GraphQLContext) => articles.deleteArchivedArticle(session(context), args.id),
    submitArticleForReview: (_: unknown, args: ArticleArgs, context: GraphQLContext) => articles.articleWorkflow(session(context), args.id, "submit"),
    requestArticleChanges: (_: unknown, args: ArticleArgs & { comment: string }, context: GraphQLContext) => articles.articleWorkflow(session(context), args.id, "requestChanges", args.comment),
    publishArticle: (_: unknown, args: ArticleArgs, context: GraphQLContext) => articles.articleWorkflow(session(context), args.id, "publish"),
    unpublishArticle: (_: unknown, args: ArticleArgs, context: GraphQLContext) => articles.articleWorkflow(session(context), args.id, "unpublish"),
    scheduleArticle: (_: unknown, args: DateArgs, context: GraphQLContext) => articles.articleWorkflow(session(context), args.id, "schedule", args.scheduledAt),
    updateArticleSchedule: (_: unknown, args: DateArgs, context: GraphQLContext) => articles.articleWorkflow(session(context), args.id, "reschedule", args.scheduledAt),
    cancelArticleSchedule: (_: unknown, args: ArticleArgs, context: GraphQLContext) => articles.articleWorkflow(session(context), args.id, "cancelSchedule"),
    archiveArticle: (_: unknown, args: ArticleArgs, context: GraphQLContext) => articles.articleWorkflow(session(context), args.id, "archive"),
    restoreArticle: (_: unknown, args: ArticleArgs, context: GraphQLContext) => articles.articleWorkflow(session(context), args.id, "restore"),
    setArticleBreaking: (_: unknown, args: ArticleArgs & { enabled: boolean }, context: GraphQLContext) => articles.setArticlePresentation(session(context), args.id, "breaking", args.enabled),
    setArticleFeatured: (_: unknown, args: ArticleArgs & { enabled: boolean }, context: GraphQLContext) => articles.setArticlePresentation(session(context), args.id, "featured", args.enabled),
  },
};
