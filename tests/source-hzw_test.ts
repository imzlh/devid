import { assertEquals, assertMatch } from "@std/assert";
import {
  buildHzwSignedUrl,
  buildHzwVideoItem,
  hzwHttpUrlOrEmpty,
  hzwTotalPages,
} from "../src/sources/hzw.ts";

Deno.test("buildHzwSignedUrl preserves existing query parameters", () => {
  const signed = buildHzwSignedUrl(
    "https://cdn.example.test/video.dat?token=abc",
    123,
    4,
    5,
  );
  const url = new URL(signed);

  assertEquals(url.searchParams.get("token"), "abc");
  assertMatch(url.searchParams.get("t") ?? "", /^123-4-5-[a-f0-9]{32}$/);
});

Deno.test("hzwTotalPages converts total item count to page count", () => {
  assertEquals(hzwTotalPages(0, 30), 1);
  assertEquals(hzwTotalPages(1, 30), 1);
  assertEquals(hzwTotalPages(30, 30), 1);
  assertEquals(hzwTotalPages(31, 30), 2);
  assertEquals(hzwTotalPages(Number.NaN, 30), 1);
});

Deno.test("hzwHttpUrlOrEmpty keeps bad media fields from throwing", () => {
  assertEquals(
    hzwHttpUrlOrEmpty("/video.dat", "https://cdn.example.test/base/"),
    "https://cdn.example.test/video.dat",
  );
  assertEquals(hzwHttpUrlOrEmpty("", "https://cdn.example.test"), "");
  assertEquals(
    hzwHttpUrlOrEmpty("javascript:alert(1)", "https://cdn.example.test"),
    "",
  );
  assertEquals(
    hzwHttpUrlOrEmpty("http://cdn.example.test/video.dat", ""),
    "http://cdn.example.test/video.dat",
  );
});

Deno.test("buildHzwVideoItem filters malformed media rows", () => {
  assertEquals(
    buildHzwVideoItem(
      {
        id: 5,
        title: " Clip ",
        url: "/media/video.dat",
        landscapeCover: "javascript:alert(1)",
        playCount: 123,
        duration: "00:01:02",
      },
      "https://cdn.example.test/base/",
      "hzw",
    ),
    {
      id: "5",
      title: "Clip",
      thumbnail: "",
      duration: "00:01:02",
      views: "123",
      url: "https://cdn.example.test/media/video.dat",
      source: "hzw",
    },
  );
  assertEquals(
    buildHzwVideoItem(
      { id: 6, title: "bad", url: "javascript:alert(1)" },
      "https://cdn.example.test",
      "hzw",
    ),
    null,
  );
  assertEquals(
    buildHzwVideoItem(null, "https://cdn.example.test", "hzw"),
    null,
  );
});
