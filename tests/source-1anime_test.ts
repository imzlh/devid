import { assertEquals, assertThrows } from "@std/assert";
import { resolveOneAnimePlayerUrl } from "../src/sources/1anime.ts";

Deno.test("resolveOneAnimePlayerUrl keeps raw player URLs", () => {
  assertEquals(
    resolveOneAnimePlayerUrl(
      { encrypt: 0, url: "https://cdn.example.test/index.m3u8" },
      "https://one.example.test/vodplay/8603-1-1.html",
    ),
    "https://cdn.example.test/index.m3u8",
  );
});

Deno.test("resolveOneAnimePlayerUrl decodes escaped and base64 player URLs", () => {
  assertEquals(
    resolveOneAnimePlayerUrl(
      { encrypt: 1, url: "https%3A%2F%2Fcdn.example.test%2Fclip.mp4" },
      "https://one.example.test/vodplay/8603-1-1.html",
    ),
    "https://cdn.example.test/clip.mp4",
  );
  assertEquals(
    resolveOneAnimePlayerUrl(
      { encrypt: 2, url: btoa("/hls/%E7%AC%AC2%E9%9B%86.m3u8") },
      "https://one.example.test/vodplay/8603-1-1.html",
    ),
    "https://one.example.test/hls/%E7%AC%AC2%E9%9B%86.m3u8",
  );
});

Deno.test("resolveOneAnimePlayerUrl rejects unknown encryption modes", () => {
  assertThrows(
    () =>
      resolveOneAnimePlayerUrl(
        { encrypt: 99, url: "/raw.m3u8" },
        "https://one.example.test/vodplay/8603-1-1.html",
      ),
    Error,
    "Unknown encrypt type 99",
  );
});
