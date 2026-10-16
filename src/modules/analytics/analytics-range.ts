import { z } from "zod";
import { validationError } from "@/src/lib/errors";

const inputSchema = z.object({
  period: z.enum(["LAST_7_DAYS", "LAST_30_DAYS", "LAST_90_DAYS", "LAST_180_DAYS", "LAST_365_DAYS", "CUSTOM"]).default("LAST_30_DAYS"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

export type AnalyticsRange = ReturnType<typeof parseAnalyticsRange>;

export function parseAnalyticsRange(input: unknown, now = new Date()) {
  const parsed = inputSchema.safeParse(input ?? {});
  if (!parsed.success) throw validationError("Invalid analytics date range");
  const { period, from, to } = parsed.data;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = 86_400_000;
  const daysByPeriod = { LAST_7_DAYS: 7, LAST_30_DAYS: 30, LAST_90_DAYS: 90, LAST_180_DAYS: 180, LAST_365_DAYS: 365 } as const;
  let start: Date;
  let end: Date;
  if (period === "CUSTOM") {
    if (!from || !to) throw validationError("Choose both custom dates");
    start = new Date(`${from}T00:00:00.000Z`);
    end = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + day);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) ||
      start.toISOString().slice(0, 10) !== from || new Date(end.getTime() - day).toISOString().slice(0, 10) !== to ||
      start >= end || end.getTime() - start.getTime() > 366 * day || end.getTime() > today + day) {
      throw validationError("Choose a valid range of at most 366 completed or current UTC days");
    }
  } else {
    if (from || to) throw validationError("Custom dates require the Custom period");
    end = new Date(today + day);
    start = new Date(end.getTime() - daysByPeriod[period] * day);
  }
  const duration = end.getTime() - start.getTime();
  const previousStart = new Date(start.getTime() - duration);
  const grouping = duration <= 31 * day ? "day" : duration <= 180 * day ? "week" : "month";
  return { period, start, end, previousStart, grouping };
}

export function pointKey(date: Date, grouping: AnalyticsRange["grouping"]) {
  const value = new Date(date);
  value.setUTCHours(0, 0, 0, 0);
  if (grouping === "week") value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  if (grouping === "month") value.setUTCDate(1);
  return value.toISOString().slice(0, 10);
}

export function fillPoints(range: AnalyticsRange, rows: { date: string; value: number }[]) {
  const values = new Map(rows.map((row) => [row.date, row.value]));
  const points: { date: string; value: number }[] = [];
  const cursor = new Date(range.start);
  while (cursor < range.end) {
    const date = pointKey(cursor, range.grouping);
    if (!points.length || points.at(-1)?.date !== date) points.push({ date, value: values.get(date) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return points;
}

export function metric(value: number, previousValue: number) {
  return { value, previousValue, percentChange: previousValue ? Math.round((value - previousValue) / previousValue * 10_000) / 100 : null };
}
