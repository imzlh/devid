import { assertEquals, assertThrows } from "@std/assert";
import { resolveAkiPlayerPath } from "../src/sources/aki.ts";

Deno.test("resolveAkiPlayerPath keeps unencrypted player URLs", () => {
  assertEquals(
    resolveAkiPlayerPath({ encrypt: 0, url: "/player/raw.html" }),
    "/player/raw.html",
  );
});

Deno.test("resolveAkiPlayerPath decodes utf8 and legacy escaped player URLs", () => {
  assertEquals(
    resolveAkiPlayerPath({
      encrypt: 1,
      url: "/player/%E7%AC%AC1%E9%9B%86.html",
    }),
    "/player/第1集.html",
  );
  assertEquals(
    resolveAkiPlayerPath({
      encrypt: 2,
      url: btoa("/player/%u7B2C2%u96C6.html"),
    }),
    "/player/第2集.html",
  );
});

Deno.test("resolveAkiPlayerPath rejects unknown encryption modes", () => {
  assertThrows(
    () => resolveAkiPlayerPath({ encrypt: 99, url: "/player/raw.html" }),
    Error,
    "Unknown encrypt type 99",
  );
});
