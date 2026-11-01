import { describe, expect, it } from "vitest";
import { pageOffset, parseSearchPage } from "@/src/lib/search";

describe("shared search contract", () => {
  it.each([undefined, null, "", "   "])("treats %j as an unfiltered search", (search) => {
    expect(parseSearchPage({ search })).toEqual({ search: undefined, page: 1, pageSize: 25 });
  });
  it("trims search and accepts Khmer without changing the text", () => {
    expect(parseSearchPage({ search: "  ព័ត៌មាន  " }).search).toBe("ព័ត៌មាន");
  });
  it("accepts 160 characters and a page size of 100", () => {
    expect(parseSearchPage({ search: "a".repeat(160), page: 2, pageSize: 100 }).pageSize).toBe(100);
    expect(pageOffset(2, 100)).toBe(100);
  });
  it.each([
    { search: "a".repeat(161) }, { page: 0 }, { page: -1 }, { page: 1.5 },
    { page: 100001 }, { pageSize: 0 }, { pageSize: 101 }, { pageSize: 1.5 },
  ])("rejects invalid input with the normal GraphQL validation error: %j", (input) => {
    expect(() => parseSearchPage(input)).toThrow(expect.objectContaining({ extensions: { code: "VALIDATION" } }));
  });
  it("uses defaults for explicit GraphQL nulls", () => {
    expect(parseSearchPage({ page: null, pageSize: null }).pageSize).toBe(25);
  });
});
