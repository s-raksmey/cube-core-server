import { describe, expect, it } from "vitest";
import { ArticleStatus } from "@prisma/client";
import { assertArticleTransition, canEditArticleStatus } from "@/src/modules/articles/article-policy";

describe("article workflow policy", () => {
  it("allows editorial content changes only in Draft", () => {
    for (const status of Object.values(ArticleStatus)) {
      expect(canEditArticleStatus(status)).toBe(status === ArticleStatus.DRAFT);
    }
  });

  it("unpublishes only a published article", () => {
    expect(() => assertArticleTransition(ArticleStatus.PUBLISHED, "unpublish")).not.toThrow();
    for (const status of [ArticleStatus.DRAFT, ArticleStatus.IN_REVIEW, ArticleStatus.SCHEDULED, ArticleStatus.ARCHIVED]) {
      expect(() => assertArticleTransition(status, "unpublish")).toThrow();
    }
  });

  it("requires Draft for Archive and Restore for Archived", () => {
    expect(() => assertArticleTransition(ArticleStatus.DRAFT, "archive")).not.toThrow();
    expect(() => assertArticleTransition(ArticleStatus.PUBLISHED, "archive")).toThrow();
    expect(() => assertArticleTransition(ArticleStatus.ARCHIVED, "restore")).not.toThrow();
  });

  it("permits permanent deletion only after archive", () => {
    expect(() => assertArticleTransition(ArticleStatus.ARCHIVED, "deleteArchived")).not.toThrow();
    for (const status of [ArticleStatus.DRAFT, ArticleStatus.IN_REVIEW, ArticleStatus.SCHEDULED, ArticleStatus.PUBLISHED]) {
      expect(() => assertArticleTransition(status, "deleteArchived")).toThrow();
    }
  });
});
