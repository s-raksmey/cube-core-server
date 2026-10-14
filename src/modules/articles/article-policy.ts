import { ArticleStatus } from "@prisma/client";
import { validationError } from "@/src/lib/errors";

export type ArticleAction =
  | "submit" | "requestChanges" | "publish" | "schedule"
  | "reschedule" | "cancelSchedule" | "archive" | "restore" | "delete";

const allowedSources: Record<ArticleAction, readonly ArticleStatus[]> = {
  submit: [ArticleStatus.DRAFT],
  requestChanges: [ArticleStatus.IN_REVIEW],
  publish: [ArticleStatus.DRAFT, ArticleStatus.IN_REVIEW],
  schedule: [ArticleStatus.DRAFT, ArticleStatus.IN_REVIEW],
  reschedule: [ArticleStatus.SCHEDULED],
  cancelSchedule: [ArticleStatus.SCHEDULED],
  archive: [ArticleStatus.PUBLISHED],
  restore: [ArticleStatus.ARCHIVED],
  delete: [ArticleStatus.DRAFT],
};

export function assertArticleTransition(status: ArticleStatus, action: ArticleAction) {
  if (!allowedSources[action].includes(status)) {
    throw validationError(`Cannot ${action} an article in ${status.toLowerCase()} status`);
  }
}

export function canEditArticleStatus(status: ArticleStatus, canEditAny: boolean) {
  return status === ArticleStatus.DRAFT ||
    (canEditAny && (status === ArticleStatus.IN_REVIEW || status === ArticleStatus.PUBLISHED));
}
