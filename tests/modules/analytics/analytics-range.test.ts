import { describe, expect, it } from "vitest";
import { fillPoints, metric, parseAnalyticsRange } from "@/src/modules/analytics/analytics-range";

describe("analytics UTC ranges", () => {
  const now = new Date("2026-10-16T17:30:00Z");

  it("compares equivalent half-open periods", () => {
    const range = parseAnalyticsRange({ period: "LAST_7_DAYS" }, now);
    expect(range.start.toISOString()).toBe("2026-10-10T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-10-17T00:00:00.000Z");
    expect(range.previousStart.toISOString()).toBe("2026-10-03T00:00:00.000Z");
    expect(fillPoints(range, [{ date: "2026-10-10", value: 2 }])).toHaveLength(7);
    expect(metric(5, 0).percentChange).toBeNull();
  });

  it("validates custom UTC calendar days and bounds", () => {
    const range = parseAnalyticsRange({ period: "CUSTOM", from: "2026-10-01", to: "2026-10-03" }, now);
    expect(range.end.toISOString()).toBe("2026-10-04T00:00:00.000Z");
    expect(range.previousStart.toISOString()).toBe("2026-09-28T00:00:00.000Z");
    expect(() => parseAnalyticsRange({ period: "CUSTOM", from: "2026-02-30", to: "2026-03-01" }, now)).toThrow();
    expect(() => parseAnalyticsRange({ period: "CUSTOM", from: "2026-10-01", to: "2026-10-18" }, now)).toThrow();
  });
});
