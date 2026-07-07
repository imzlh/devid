import { assertEquals } from "@std/assert";
import {
  parseOptionalNumber,
  parsePositiveInteger,
} from "../src/utils/number.ts";

Deno.test("parsePositiveInteger extracts safe positive page numbers", () => {
  assertEquals(parsePositiveInteger("12"), 12);
  assertEquals(parsePositiveInteger("共 12 页"), 12);
  assertEquals(parsePositiveInteger("0", 1), 1);
  assertEquals(parsePositiveInteger("bad", 7), 7);
  assertEquals(parsePositiveInteger("bad", NaN), 1);
  assertEquals(parsePositiveInteger("bad", -3), 1);
});

Deno.test("parseOptionalNumber extracts decimal ratings without returning NaN", () => {
  assertEquals(parseOptionalNumber("8.5分"), 8.5);
  assertEquals(parseOptionalNumber(".75"), 0.75);
  assertEquals(parseOptionalNumber("暂无评分"), undefined);
  assertEquals(parseOptionalNumber(undefined), undefined);
});
