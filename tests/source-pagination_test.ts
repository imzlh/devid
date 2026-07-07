import { assertEquals, assertExists } from "@std/assert";
import { DOMParser } from "dom";
import {
  lastChildHref,
  parseOneAnimeTotalPages,
} from "../src/sources/1anime.ts";
import { parseHAnimePagination } from "../src/sources/hanime.ts";

Deno.test("1Anime pagination reads the last child href instead of item(-1)", () => {
  const doc = new DOMParser().parseFromString(
    `
    <div id="page">
      <a href="/vodsearch/q----------1---.html">1</a>
      <a href="/vodsearch/q----------12---.html">尾页</a>
    </div>
    `,
    "text/html",
  );
  assertExists(doc);
  const page = doc.querySelector("#page");
  assertExists(page);

  assertEquals(lastChildHref(page), "/vodsearch/q----------12---.html");
  assertEquals(parseOneAnimeTotalPages(lastChildHref(page)), 12);
  assertEquals(parseOneAnimeTotalPages(undefined), 1);
});

Deno.test("HAnime pagination falls back when page indicator is malformed", () => {
  assertEquals(parseHAnimePagination("3 / 8"), [3, 8]);
  assertEquals(parseHAnimePagination("bad / value"), [1, 1]);
  assertEquals(parseHAnimePagination(undefined), [1, 1]);
});
