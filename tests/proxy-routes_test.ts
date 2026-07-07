import { assertEquals } from "@std/assert";
import { Hono } from "hono";
import {
  isM3U8Request,
  normalizeProxyBodyType,
  normalizeProxyReferer,
  normalizeProxyUrl,
  normalizeRangeHeader,
  normalizeRemoteProxyMode,
  registerProxyRoutes,
} from "../src/server/proxy-routes.ts";

Deno.test("normalizeProxyUrl returns normalized http URLs", () => {
  assertEquals(
    normalizeProxyUrl("  https://cdn.example.test/video.mp4?x=1  "),
    "https://cdn.example.test/video.mp4?x=1",
  );
});

Deno.test("normalizeProxyUrl decodes encoded proxy URL parameters", () => {
  assertEquals(
    normalizeProxyUrl(
      encodeURIComponent("https://cdn.example.test/live/index.m3u8"),
    ),
    "https://cdn.example.test/live/index.m3u8",
  );
});

Deno.test("normalizeProxyUrl rejects non-http URLs", () => {
  assertEquals(normalizeProxyUrl("javascript:alert(1)"), null);
  assertEquals(
    normalizeProxyUrl(encodeURIComponent("file:///tmp/video.mp4")),
    null,
  );
});

Deno.test("normalizeProxyReferer trims and rejects invalid referers", () => {
  assertEquals(
    normalizeProxyReferer("  https://site.example.test/watch?id=1  "),
    "https://site.example.test/watch?id=1",
  );
  assertEquals(normalizeProxyReferer("javascript:alert(1)"), undefined);
  assertEquals(normalizeProxyReferer("   "), undefined);
});

Deno.test("normalizeProxyBodyType and remote proxy mode trim query values", () => {
  assertEquals(normalizeProxyBodyType(" M3U8 "), "m3u8");
  assertEquals(normalizeProxyBodyType(" h5 "), "h5");
  assertEquals(normalizeProxyBodyType("   "), undefined);
  assertEquals(normalizeRemoteProxyMode(" REMOTE "), "remote");
  assertEquals(normalizeRemoteProxyMode(" local "), undefined);
});

Deno.test("normalizeRangeHeader accepts byte ranges and drops malformed values", () => {
  assertEquals(normalizeRangeHeader(" bytes=0- "), "bytes=0-");
  assertEquals(normalizeRangeHeader("bytes=-500"), "bytes=-500");
  assertEquals(
    normalizeRangeHeader("bytes=0-99,200-299"),
    "bytes=0-99,200-299",
  );
  assertEquals(normalizeRangeHeader("items=0-99"), undefined);
  assertEquals(normalizeRangeHeader("bytes=abc"), undefined);
  assertEquals(normalizeRangeHeader("bytes=99-0"), undefined);
  assertEquals(normalizeRangeHeader("bytes=-0"), undefined);
  assertEquals(normalizeRangeHeader("bytes=0-99;foo=bar"), undefined);
});

Deno.test("image proxy route uses normalized URL and source values", async () => {
  const app = new Hono();
  const calls: Array<{ sourceId: string; imageUrl: string }> = [];
  registerProxyRoutes(app, {
    videoSourceManager: {
      getSource(sourceId: string) {
        return {
          getImage(imageUrl: string) {
            calls.push({ sourceId, imageUrl });
            return Promise.resolve({
              data: new Uint8Array([1, 2, 3]),
              contentType: "image/jpeg",
            });
          },
        };
      },
    },
    downloadManager: {},
  } as never);

  const response = await app.request(
    "/api/image-proxy?url=%20https%3A%2F%2Fimg.example.test%2Fcover.jpg%3Fx%3D1%20&source=%20Source-A%20",
  );

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("content-type"), "image/jpeg");
  assertEquals(
    await response.arrayBuffer().then((buffer) => [...new Uint8Array(buffer)]),
    [
      1,
      2,
      3,
    ],
  );
  assertEquals(calls, [{
    sourceId: "Source-A",
    imageUrl: "https://img.example.test/cover.jpg?x=1",
  }]);
});

Deno.test("isM3U8Request keeps explicit H5 proxy requests out of playlist rewriting", () => {
  assertEquals(
    isM3U8Request(
      "https://cdn.example.test/video.mp4?type=m3u8",
      "application/vnd.apple.mpegurl",
      "h5",
    ),
    false,
  );
  assertEquals(
    isM3U8Request(
      "/api/proxy/playlist.m3u8?url=https%3A%2F%2Fcdn.example.test%2Fvideo.mp4&type=h5",
      "application/octet-stream",
    ),
    false,
  );
});

Deno.test("isM3U8Request lets H5 URL evidence beat misleading HLS content type", () => {
  assertEquals(
    isM3U8Request(
      "https://cdn.example.test/video.mp4?token=abc",
      "application/vnd.apple.mpegurl",
    ),
    false,
  );
  assertEquals(
    isM3U8Request(
      "https://cdn.example.test/download?file=episode.mp4",
      "application/x-mpegurl",
    ),
    false,
  );
});

Deno.test("isM3U8Request detects explicit playlist proxy requests", () => {
  assertEquals(
    isM3U8Request(
      "https://cdn.example.test/play?id=1",
      "application/octet-stream",
      "m3u8",
    ),
    true,
  );
  assertEquals(
    isM3U8Request(
      "https://cdn.example.test/live/index.m3u8",
      "application/octet-stream",
      "h5",
    ),
    true,
  );
  assertEquals(
    isM3U8Request(
      "https://cdn.example.test/video.mp4",
      "application/vnd.apple.mpegurl",
      "m3u8",
    ),
    false,
  );
});

Deno.test("isM3U8Request normalizes proxy type parameters before routing", () => {
  assertEquals(
    isM3U8Request(
      "https://cdn.example.test/play?id=1",
      "application/octet-stream",
      " M3U8 ",
    ),
    true,
  );
  assertEquals(
    isM3U8Request(
      "https://cdn.example.test/play?id=1",
      "application/vnd.apple.mpegurl",
      " H5 ",
    ),
    false,
  );
});
