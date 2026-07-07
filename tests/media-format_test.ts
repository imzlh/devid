import { assertEquals } from "@std/assert";
import {
  inferMediaFormat,
  isPlayableMediaUrl,
  looksLikeH5Url,
  looksLikeM3u8Url,
} from "../src/utils/media-format.ts";

Deno.test("inferMediaFormat prefers explicit H5 URL evidence over bad HLS hints", () => {
  const signedMp4 =
    "https://cdn.example.test/video?id=1&response-content-disposition=attachment%3B%20filename%3Depisode.mp4";

  assertEquals(looksLikeH5Url(signedMp4), true);
  assertEquals(looksLikeM3u8Url(signedMp4), false);
  assertEquals(inferMediaFormat(signedMp4, "hls"), "h5");
  assertEquals(
    inferMediaFormat("https://cdn.example.test/video.mp4?type=m3u8", "m3u8"),
    "h5",
  );
  assertEquals(
    inferMediaFormat(
      "https://cdn.example.test/play?url=https%3A%2F%2Fmedia.example.test%2Fclip.mp4&type=hls",
      "m3u8",
    ),
    "h5",
  );
});

Deno.test("inferMediaFormat lets direct H5 evidence beat misleading HLS hints", () => {
  assertEquals(
    inferMediaFormat(
      "https://cdn.example.test/proxy/playlist.m3u8",
      "video/mp4",
    ),
    "h5",
  );
  assertEquals(
    inferMediaFormat("https://cdn.example.test/play.m3u8", "video/webm"),
    "h5",
  );
});

Deno.test("inferMediaFormat keeps real m3u8 URLs in HLS despite weak H5 hints", () => {
  assertEquals(
    inferMediaFormat("https://cdn.example.test/play.m3u8", "video"),
    "m3u8",
  );
  assertEquals(
    inferMediaFormat("https://cdn.example.test/play.m3u8", "h5"),
    "m3u8",
  );
});

Deno.test("inferMediaFormat detects real m3u8 URLs and type hints", () => {
  assertEquals(inferMediaFormat("https://cdn.example.test/index.m3u8"), "m3u8");
  assertEquals(
    inferMediaFormat(
      "https://cdn.example.test/play?id=1",
      "application/vnd.apple.mpegurl",
    ),
    "m3u8",
  );
});

Deno.test("inferMediaFormat keeps ordinary H5 video URLs out of the HLS path", () => {
  assertEquals(inferMediaFormat("https://cdn.example.test/video.mp4"), "h5");
  assertEquals(
    inferMediaFormat("https://cdn.example.test/video.webm?token=abc"),
    "h5",
  );
});

Deno.test("inferMediaFormat treats explicit H5 proxy type as H5 evidence", () => {
  const proxiedH5 =
    "/api/proxy/playlist.m3u8?url=https%3A%2F%2Fcdn.example.test%2Fvideo.mp4&type=h5";

  assertEquals(looksLikeH5Url(proxiedH5), true);
  assertEquals(looksLikeM3u8Url(proxiedH5), false);
  assertEquals(inferMediaFormat(proxiedH5), "h5");
});

Deno.test("isPlayableMediaUrl rejects plain player pages mislabelled as H5", () => {
  assertEquals(isPlayableMediaUrl("https://cdn.example.test/play?id=1"), false);
  assertEquals(
    isPlayableMediaUrl("https://cdn.example.test/play?id=1", "h5"),
    false,
  );
  assertEquals(
    isPlayableMediaUrl("https://cdn.example.test/watch", "video"),
    false,
  );
  assertEquals(
    isPlayableMediaUrl("https://cdn.example.test/watch", "video/mp4"),
    true,
  );
  assertEquals(
    isPlayableMediaUrl("https://cdn.example.test/video.mp4?token=abc", "h5"),
    true,
  );
});

Deno.test("media format inference tolerates malformed runtime type hints", () => {
  assertEquals(
    inferMediaFormat("https://cdn.example.test/video.mp4", 1),
    "h5",
  );
  assertEquals(
    inferMediaFormat("https://cdn.example.test/live/index.m3u8", {
      type: "h5",
    }),
    "m3u8",
  );
  assertEquals(
    isPlayableMediaUrl("https://cdn.example.test/watch", { type: "hls" }),
    false,
  );
});
