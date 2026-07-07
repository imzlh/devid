import { assertEquals } from "@std/assert";
import { httpUrlOrEmpty, httpUrlOrFallback } from "../src/sources/index.ts";

Deno.test("httpUrlOrFallback rejects script URLs and falls back to page URL", () => {
  assertEquals(
    httpUrlOrFallback(
      "javascript:",
      "https://source.example.test",
      "https://source.example.test/detail/series.html",
    ),
    "https://source.example.test/detail/series.html",
  );
});

Deno.test("httpUrlOrFallback resolves relative http paths", () => {
  assertEquals(
    httpUrlOrFallback(
      "/play/series-1.html",
      "https://source.example.test",
      "https://source.example.test/detail/series.html",
    ),
    "https://source.example.test/play/series-1.html",
  );
});

Deno.test("httpUrlOrEmpty rejects script and malformed URLs without throwing", () => {
  assertEquals(
    httpUrlOrEmpty("javascript:alert(1)", "https://source.example.test"),
    "",
  );
  assertEquals(
    httpUrlOrEmpty("https://[", "https://source.example.test"),
    "",
  );
  assertEquals(
    httpUrlOrEmpty("/cover.jpg", "https://source.example.test"),
    "https://source.example.test/cover.jpg",
  );
});
