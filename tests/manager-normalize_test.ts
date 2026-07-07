import { assertEquals, assertExists } from "@std/assert";
import {
  normalizeSeriesResult,
  normalizeVideoList,
  normalizeVideoUrls,
} from "../src/manager.ts";
import { URLProxy } from "../src/types/index.ts";

Deno.test("normalizeVideoUrls restores default local proxy for m3u8 when source proxy is invalid", () => {
  const [video] = normalizeVideoUrls(
    [
      {
        url: "https://cdn.example.test/live/index.m3u8",
        quality: "",
        proxy: 999 as URLProxy,
      },
    ],
    "https://site.example.test/watch",
    "source-a",
  );

  assertEquals(video.format, "m3u8");
  assertEquals(video.proxy, URLProxy.LOCAL);
  assertEquals(video.quality, "默认");
});

Deno.test("normalizeVideoUrls preserves explicit proxy none for m3u8", () => {
  const [video] = normalizeVideoUrls(
    [
      {
        url: "https://cdn.example.test/live/index.m3u8",
        quality: "HD",
        proxy: URLProxy.NONE,
      },
    ],
    "https://site.example.test/watch",
    "source-a",
  );

  assertEquals(video.format, "m3u8");
  assertEquals(video.proxy, URLProxy.NONE);
});

Deno.test("normalizeVideoUrls does not let weak H5 hints override m3u8 URLs", () => {
  const videos = normalizeVideoUrls(
    [
      {
        url: "https://cdn.example.test/live/index.m3u8",
        quality: "HD",
        format: "h5",
      },
      {
        url: "https://cdn.example.test/live/alt.m3u8",
        quality: "SD",
        format: "video" as never,
      },
    ],
    "https://site.example.test/watch",
    "source-a",
  );

  assertEquals(videos.map((video) => video.format), ["m3u8", "m3u8"]);
  assertEquals(videos.map((video) => video.proxy), [
    URLProxy.LOCAL,
    URLProxy.LOCAL,
  ]);
});

Deno.test("normalizeVideoUrls tolerates malformed playback result shapes", () => {
  assertEquals(
    normalizeVideoUrls(null, "https://site.example.test/watch", "source-a"),
    [],
  );
  assertEquals(
    normalizeVideoUrls(
      [
        null,
        "bad",
        { url: "" },
        { url: "javascript:alert(1)", quality: "bad" },
        {
          url: "/media/clip.mp4",
          quality: 720,
          resolution: " 1080p ",
          bandwidth: "2500",
          referrer: "/watch",
          proxy: 999,
        },
      ],
      "https://site.example.test/watch",
      "source-a",
    ),
    [
      {
        url: "https://site.example.test/media/clip.mp4",
        quality: "1080p",
        resolution: "1080p",
        bandwidth: 2500,
        format: "h5",
        referrer: "https://site.example.test/watch",
        proxy: undefined,
      },
    ],
  );
});

Deno.test("normalizeVideoUrls drops player pages mislabelled as H5", () => {
  assertEquals(
    normalizeVideoUrls(
      [
        { url: "/play?id=1", format: "h5", quality: "bad" },
        { url: "/watch", format: "video" as never, quality: "bad" },
        { url: "/media/clip.mp4", format: "h5", quality: "ok" },
      ],
      "https://site.example.test/watch",
      "source-a",
    ).map((video) => video.url),
    ["https://site.example.test/media/clip.mp4"],
  );
});

Deno.test("normalizeVideoList pins source id, normalizes URLs, and drops bad rows", () => {
  const list = normalizeVideoList(
    {
      currentPage: 0,
      totalPages: 1,
      videos: [
        null as never,
        "bad" as never,
        {
          id: "a",
          title: "A",
          thumbnail: "/cover-a.jpg",
          url: "/watch/a",
          source: "display-name",
        },
        {
          id: "a",
          title: "Duplicate",
          thumbnail: "/cover-dup.jpg",
          url: "/watch/dup",
          source: "display-name",
        },
        {
          id: "bad",
          title: "Bad",
          thumbnail: "/bad.jpg",
          url: "javascript:alert(1)",
          source: "display-name",
        },
        {
          id: "bad-title",
          title: 123 as never,
          thumbnail: "/bad.jpg",
          url: "/watch/bad-title",
          source: "display-name",
        },
      ],
    },
    3,
    "source-a",
    "https://site.example.test/base/",
  );

  assertEquals(list.currentPage, 3);
  assertEquals(list.totalPages, 3);
  assertEquals(list.videos.length, 1);
  assertEquals(list.videos[0].source, "source-a");
  assertEquals(list.videos[0].url, "https://site.example.test/watch/a");
  assertEquals(
    list.videos[0].thumbnail,
    "https://site.example.test/cover-a.jpg",
  );
});

Deno.test("normalizeVideoList tolerates malformed source list shape", () => {
  assertEquals(
    normalizeVideoList(null, 2, "source-a", "https://site.example.test"),
    {
      videos: [],
      currentPage: 2,
      totalPages: 2,
    },
  );
  assertEquals(
    normalizeVideoList(
      { currentPage: "bad" as never, totalPages: 0, videos: null as never },
      4,
      "source-a",
      "https://site.example.test",
    ),
    {
      videos: [],
      currentPage: 4,
      totalPages: 4,
    },
  );
});

Deno.test("normalizeSeriesResult pins source id and filters bad episodes", () => {
  const result = normalizeSeriesResult(
    {
      id: "",
      seriesId: "",
      title: "",
      thumbnail: "/series.jpg",
      totalEpisodes: 0,
      source: "display-name",
      url: "/detail/show",
      episodes: [
        null as never,
        {
          id: "",
          seriesId: "",
          title: "",
          episodeNumber: 0,
          thumbnail: "/ep.jpg",
          url: "/play/1",
        },
        {
          id: "bad",
          seriesId: "",
          title: "Bad",
          episodeNumber: 2,
          url: "javascript:alert(1)",
        },
      ],
    },
    "show",
    "source-a",
    "https://site.example.test/base/",
  );

  assertEquals(result?.source, "source-a");
  assertEquals(result?.seriesId, "show");
  assertEquals(result?.title, "show");
  assertEquals(result?.thumbnail, "https://site.example.test/series.jpg");
  assertEquals(result?.url, "https://site.example.test/detail/show");
  assertEquals(result?.totalEpisodes, 1);
  assertExists(result?.episodes);
  const [episode] = result.episodes;
  assertExists(episode);
  assertEquals(episode.seriesId, "show");
  assertEquals(episode.title, "第 1 集");
  assertEquals(episode.episodeNumber, 1);
  assertEquals(
    episode.thumbnail,
    "https://site.example.test/ep.jpg",
  );
  assertEquals(episode.url, "https://site.example.test/play/1");
});

Deno.test("normalizeSeriesResult tolerates malformed episode shape", () => {
  const result = normalizeSeriesResult(
    {
      title: "",
      thumbnail: undefined,
      totalEpisodes: 0,
      episodes: null as never,
    },
    "",
    "source-a",
    "https://site.example.test",
  );

  assertEquals(result?.id, "series");
  assertEquals(result?.seriesId, "series");
  assertEquals(result?.source, "source-a");
  assertEquals(result?.title, "series");
  assertEquals(result?.episodes, []);
  assertEquals(result?.totalEpisodes, 0);
});
