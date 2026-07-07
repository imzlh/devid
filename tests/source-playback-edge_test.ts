import { assertEquals, assertThrows } from "@std/assert";
import { build17cSearchPath, build17cVideoItem } from "../src/sources/17c.ts";
import {
  buildGG51VideoItem,
  resolveGG51MediaUrl,
} from "../src/sources/gg51.ts";
import {
  buildKpdzImageUrl,
  buildKpdzVideoItem,
  buildKpdzVideoUrl,
  formatKpdzDuration,
} from "../src/sources/kpdz.ts";

Deno.test("GG51 resolves relative player media URL against the watch page", () => {
  assertEquals(
    resolveGG51MediaUrl(
      "/media/video.mp4?token=abc",
      "https://gg.example.test/view/123",
    ),
    "https://gg.example.test/media/video.mp4?token=abc",
  );
  assertEquals(
    resolveGG51MediaUrl(
      "hls/index.m3u8",
      "https://gg.example.test/view/123",
    ),
    "https://gg.example.test/view/hls/index.m3u8",
  );
});

Deno.test("GG51 rejects non-http player media URL", () => {
  assertThrows(
    () => resolveGG51MediaUrl("javascript:alert(1)", "https://gg.example.test"),
    Error,
    "不支持的播放地址协议",
  );
});

Deno.test("GG51 video item builder filters malformed API rows", () => {
  assertEquals(
    buildGG51VideoItem(
      {
        view_key: "abc",
        title: " Clip ",
        poster: "javascript:alert(1)",
        play_url: "/view/media.mp4",
        duration: 65,
      },
      "https://gg.example.test",
      "gg51",
    ),
    {
      id: "abc",
      title: "Clip",
      thumbnail: "",
      duration: "65",
      url: "https://gg.example.test/view/media.mp4",
      source: "gg51",
    },
  );
  assertEquals(
    buildGG51VideoItem(
      { view_key: "bad", title: "bad", play_url: "javascript:alert(1)" },
      "https://gg.example.test",
      "gg51",
    ),
    null,
  );
  assertEquals(
    buildGG51VideoItem(
      { view_key: "", title: "bad", play_url: "/clip.mp4" },
      "https://gg.example.test",
      "gg51",
    ),
    null,
  );
});

Deno.test("17C search path encodes the query instead of splicing raw text", () => {
  const path = build17cSearchPath("a&b c", 2);
  const url = new URL(path, "https://api.example.test");

  assertEquals(url.pathname, "/v1/vod");
  assertEquals(url.searchParams.get("page"), "2");
  assertEquals(url.searchParams.get("name"), "a&b c");
});

Deno.test("17C video item builder filters ads and malformed rows", () => {
  assertEquals(
    build17cVideoItem(
      {
        id: 12,
        name: " Clip ",
        enc_img: "javascript:alert(1)",
        eye: 100,
        time: "03:00",
      },
      "https://17c.example.test",
      "17c",
    ),
    {
      id: "12",
      title: "Clip",
      thumbnail: "",
      duration: "03:00",
      views: "100",
      url: "https://17c.example.test/videoplay/0.html?v=12",
      source: "17c",
    },
  );
  assertEquals(
    build17cVideoItem(
      {
        id: 13,
        name: "ad",
        enc_img: "/ad.jpg",
        eye: 1,
        time: "1",
        is_yp: true,
      },
      "https://17c.example.test",
      "17c",
    ),
    null,
  );
  assertEquals(
    build17cVideoItem(
      { id: 14, name: "   " },
      "https://17c.example.test",
      "17c",
    ),
    null,
  );
});

Deno.test("KPDZ playback URL skips empty VIP hosts and normalizes duration", () => {
  const lines = [
    { name: "vip", url: [], sort: 1, is_vip: true },
    { name: "normal", url: ["media.example.test"], sort: 2 },
  ];

  assertEquals(
    buildKpdzVideoUrl("/play/clip.m3u8", lines),
    "https://media.example.test/play/clip.m3u8",
  );
  assertEquals(formatKpdzDuration("65"), "01:05");
  assertEquals(formatKpdzDuration("bad"), "00:00");
  assertEquals(formatKpdzDuration(Number.NaN), "00:00");
});

Deno.test("KPDZ video item builder filters malformed rows", () => {
  const lines = [{ name: "normal", url: ["media.example.test"], sort: 1 }];

  assertEquals(
    buildKpdzImageUrl("/cover.jpg", "img.example.test"),
    "https://img.example.test/cover.jpg",
  );
  assertEquals(buildKpdzImageUrl(undefined, "img.example.test"), "");
  assertEquals(
    buildKpdzVideoItem(
      {
        id: 7,
        name: " Clip ",
        pic: "/cover.jpg",
        play_url: "/play/clip.mp4",
        duration: "70",
      },
      lines,
      "img.example.test",
      "kpdz",
    ),
    {
      id: "7",
      title: "Clip",
      thumbnail: "https://img.example.test/cover.jpg",
      duration: "01:10",
      url: "https://media.example.test/play/clip.mp4",
      source: "kpdz",
    },
  );
  assertEquals(buildKpdzVideoItem(null, lines, undefined, "kpdz"), null);
  assertEquals(
    buildKpdzVideoItem(
      { id: 8, name: "bad", play_url: "" },
      lines,
      undefined,
      "kpdz",
    ),
    null,
  );
  assertEquals(
    buildKpdzVideoItem(
      { id: 9, name: "bad", play_url: "/clip.mp4" },
      [],
      undefined,
      "kpdz",
    ),
    null,
  );
});
