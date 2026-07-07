import { assert, assertEquals } from "@std/assert";
import {
  bestQuality,
  normalizePlaybackUrls,
  playbackUrl,
} from "../web/src/utils/media.ts";
import { chooseAvailableSourceId } from "../web/src/utils/source.ts";
import {
  cancelDownload,
  deleteDownload,
  normalizeActiveSource,
  normalizeClearCompletedResponse,
  normalizeDownloadTasks,
  normalizeReinitSourceResponse,
  normalizeSourceHealthMap,
  normalizeSourceHealthResponse,
  normalizeSources,
  normalizeSuccessResponse,
  retryDownload,
  setRpcClient,
  startDownload,
} from "../web/src/api/client.ts";
import { URLProxy, type VideoUrl } from "../web/src/types/api.ts";

Deno.test("web playbackUrl keeps m3u8 URLs on the HLS proxy path despite weak H5 hints", () => {
  const url = playbackUrl({
    url: "https://cdn.example.test/live/index.m3u8",
    quality: "HD",
    format: "h5",
  });

  assert(url.startsWith("/api/proxy/index.m3u8?"));
  const parsed = new URL(url, "https://app.example.test");
  assertEquals(
    parsed.searchParams.get("url"),
    "https://cdn.example.test/live/index.m3u8",
  );
  assertEquals(parsed.searchParams.get("type"), "m3u8");
});

Deno.test("web playbackUrl keeps direct H5 media out of the HLS proxy path", () => {
  assertEquals(
    playbackUrl({
      url: "https://cdn.example.test/video.mp4?type=m3u8",
      quality: "HD",
      format: "m3u8",
    }),
    "https://cdn.example.test/video.mp4?type=m3u8",
  );

  const proxied = playbackUrl({
    url: "https://cdn.example.test/video.mp4",
    quality: "HD",
    format: "h5",
    proxy: URLProxy.LOCAL,
  });
  const parsed = new URL(proxied, "https://app.example.test");
  assertEquals(parsed.pathname, "/api/proxy/video.mp4");
  assertEquals(parsed.searchParams.get("type"), "h5");
});

Deno.test("web media normalization drops player pages mislabelled as H5", () => {
  const normalized = normalizePlaybackUrls([
    { url: "https://site.example.test/watch?id=1", format: "h5" },
    { url: "javascript:alert(1)", format: "m3u8" },
    { url: 1, format: "h5" },
    { url: "https://cdn.example.test/video.webm", quality: "WebM" },
  ]);

  assertEquals(normalized.length, 1);
  assertEquals(normalized[0].url, "https://cdn.example.test/video.webm");
  assertEquals(normalized[0].format, "h5");
  assertEquals(
    playbackUrl(normalized[0]),
    "https://cdn.example.test/video.webm",
  );
});

Deno.test("web media normalization trims media URLs explicitly", () => {
  const [normalized] = normalizePlaybackUrls([
    { url: " https://cdn.example.test/video.mp4 ", quality: " MP4 " },
  ]);

  assertEquals(normalized.url, "https://cdn.example.test/video.mp4");
  assertEquals(normalized.quality, "MP4");
  assertEquals(playbackUrl(normalized), "https://cdn.example.test/video.mp4");
});

Deno.test("web media normalization tolerates malformed runtime format hints", () => {
  const normalized = normalizePlaybackUrls([
    { url: "https://cdn.example.test/video.mp4", format: 1 },
    {
      url: "https://cdn.example.test/live/index.m3u8",
      format: { type: "h5" },
    },
    { url: "https://site.example.test/watch", format: { type: "hls" } },
  ]);

  assertEquals(normalized.map((video) => video.format), ["h5", "m3u8"]);
});

Deno.test("web bestQuality normalizes malformed lists before choosing", () => {
  const videos: Partial<VideoUrl>[] = [
    { url: "https://site.example.test/play", format: "h5", bandwidth: 9999 },
    {
      url: "https://cdn.example.test/low/index.m3u8",
      quality: "低清",
      bandwidth: 500,
    },
    {
      url: "https://cdn.example.test/high/index.m3u8",
      quality: "高清",
      bandwidth: 1500,
    },
  ];

  const selected = bestQuality(videos);
  assertEquals(selected?.url, "https://cdn.example.test/high/index.m3u8");
  assertEquals(selected?.format, "m3u8");
  assertEquals(selected?.proxy, URLProxy.LOCAL);
});

Deno.test("web download task normalization infers format from URL evidence", () => {
  const [m3u8Task, h5Task] = normalizeDownloadTasks([
    {
      id: "m3u8",
      url: "https://cdn.example.test/live/index.m3u8",
      title: "Live",
      outputPath: "./downloads",
      fileName: "Live.mp4",
      filePath: "./downloads/Live.mp4",
      format: "h5",
      status: "pending",
      progress: Number.NaN,
      createTime: "bad date",
    },
    {
      id: "h5",
      url: "https://cdn.example.test/video.mp4?type=m3u8",
      title: "Clip",
      outputPath: "./downloads",
      fileName: "Clip.mp4",
      filePath: "./downloads/Clip.mp4",
      format: "m3u8",
      proxy: URLProxy.LOCAL,
      status: "pending",
      progress: 120,
      createTime: new Date("2026-01-01T00:00:00Z").toISOString(),
    },
  ]);

  assertEquals(m3u8Task.format, "m3u8");
  assertEquals(m3u8Task.progress, 0);
  assertEquals(h5Task.format, "h5");
  assertEquals(h5Task.proxy, URLProxy.LOCAL);
  assertEquals(h5Task.progress, 100);
});

Deno.test("web source normalizers reject malformed source state", () => {
  assertEquals(normalizeActiveSource(null), {
    id: null,
    name: null,
    imageAspectRatio: "16/9",
  });
  assertEquals(
    normalizeActiveSource({
      id: " source-a ",
      name: " Source A ",
      imageAspectRatio: "",
    }),
    {
      id: "source-a",
      name: "Source A",
      imageAspectRatio: "16/9",
    },
  );

  assertEquals(
    normalizeSources([
      null,
      { id: "", name: "bad", baseUrl: "https://bad.example.test" },
      { id: "a", name: "A", baseUrl: "javascript:alert(1)" },
      { id: "a", name: "Duplicate", baseUrl: "https://dup.example.test" },
      {
        id: "b",
        name: "B",
        baseUrl: "https://b.example.test",
        enabled: false,
        health: {
          status: "bad",
          lastCheck: "12",
          consecutiveFailures: Number.NaN,
          circuitOpen: "yes",
          circuitOpenUntil: 5,
        },
      },
    ]),
    [
      {
        id: "a",
        name: "A",
        baseUrl: "",
        enabled: true,
        imageAspectRatio: undefined,
        health: undefined,
      },
      {
        id: "b",
        name: "B",
        baseUrl: "https://b.example.test/",
        enabled: false,
        imageAspectRatio: undefined,
        health: {
          status: "unknown",
          lastCheck: 12,
          consecutiveFailures: 0,
          circuitOpen: false,
          circuitOpenUntil: 5,
          lastError: undefined,
        },
      },
    ],
  );
});

Deno.test("web source health response normalization filters malformed keys", () => {
  assertEquals(normalizeSourceHealthMap(null), null);
  assertEquals(normalizeSourceHealthMap({}), null);
  assertEquals(normalizeSourceHealthMap({ "": { status: "healthy" } }), null);

  assertEquals(
    normalizeSourceHealthMap({
      " source-a ": {
        status: "healthy",
        lastCheck: "10",
        consecutiveFailures: "2",
        circuitOpen: true,
        circuitOpenUntil: "30",
        lastError: " ok ",
      },
    }),
    {
      "source-a": {
        status: "healthy",
        lastCheck: 10,
        consecutiveFailures: 2,
        circuitOpen: true,
        circuitOpenUntil: 30,
        lastError: "ok",
      },
    },
  );

  assertEquals(
    normalizeSourceHealthResponse({
      initialized: "true",
      activeSourceId: " active ",
      health: {
        "": { status: "healthy", lastCheck: 1 },
        " source-a ": {
          status: "unhealthy",
          lastCheck: 10,
          consecutiveFailures: 2,
          circuitOpen: true,
          circuitOpenUntil: 20,
          lastError: " failed ",
        },
      },
    }),
    {
      initialized: false,
      activeSourceId: "active",
      health: {
        "source-a": {
          status: "unhealthy",
          lastCheck: 10,
          consecutiveFailures: 2,
          circuitOpen: true,
          circuitOpenUntil: 20,
          lastError: "failed",
        },
      },
    },
  );
});

Deno.test("web action response normalizers require literal success true", () => {
  assertEquals(normalizeSuccessResponse({ success: true }), { success: true });
  assertEquals(normalizeSuccessResponse({ success: "true" }), {
    success: false,
  });
  assertEquals(normalizeSuccessResponse({ success: 1 }), { success: false });
  assertEquals(normalizeSuccessResponse(null), { success: false });

  assertEquals(
    normalizeClearCompletedResponse({
      success: "yes",
      clearedCount: "3",
      deletedFiles: Number.NaN,
    }),
    {
      success: false,
      clearedCount: 3,
      deletedFiles: 0,
    },
  );
  assertEquals(
    normalizeReinitSourceResponse({
      success: 1,
      activeSourceId: " source-a ",
      health: { status: "healthy", lastCheck: "5" },
    }),
    {
      success: false,
      activeSourceId: "source-a",
      health: {
        status: "healthy",
        lastCheck: 5,
        consecutiveFailures: 0,
        circuitOpen: false,
        circuitOpenUntil: 0,
        lastError: undefined,
      },
    },
  );
});

Deno.test("web download REST fallback encodes task ids in route paths", async () => {
  const originalFetch = globalThis.fetch;
  const seen: string[] = [];
  setRpcClient(null);
  globalThis.fetch = ((input: string | URL | Request) => {
    seen.push(input instanceof Request ? input.url : String(input));
    return Promise.resolve(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;

  try {
    const id = " imported/id ?x=1 ";
    assertEquals(await startDownload(id), { success: true });
    assertEquals(await cancelDownload(id), { success: true });
    assertEquals(await retryDownload(id), { success: true });
    assertEquals(await deleteDownload(id, true), { success: true });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assertEquals(seen, [
    "/api/downloads/%20imported%2Fid%20%3Fx%3D1%20/start",
    "/api/downloads/%20imported%2Fid%20%3Fx%3D1%20/cancel",
    "/api/downloads/%20imported%2Fid%20%3Fx%3D1%20/retry",
    "/api/downloads/%20imported%2Fid%20%3Fx%3D1%20?deleteFile=true",
  ]);
});

Deno.test("web source selection falls back when active source is unavailable", () => {
  const sources = [
    {
      id: "bad",
      name: "Bad",
      baseUrl: "https://bad.example.test",
      enabled: true,
    },
    {
      id: "good",
      name: "Good",
      baseUrl: "https://good.example.test",
      enabled: true,
    },
    {
      id: "disabled",
      name: "Disabled",
      baseUrl: "https://disabled.example.test",
      enabled: false,
    },
  ];

  assertEquals(
    chooseAvailableSourceId(sources, "good", {
      good: {
        status: "healthy",
        lastCheck: 1,
        consecutiveFailures: 0,
        circuitOpen: false,
        circuitOpenUntil: 0,
      },
    }),
    "good",
  );
  assertEquals(
    chooseAvailableSourceId(sources, "bad", {
      bad: {
        status: "unhealthy",
        lastCheck: 1,
        consecutiveFailures: 1,
        circuitOpen: true,
        circuitOpenUntil: 10,
      },
      good: {
        status: "healthy",
        lastCheck: 1,
        consecutiveFailures: 0,
        circuitOpen: false,
        circuitOpenUntil: 0,
      },
    }),
    "good",
  );
  assertEquals(
    chooseAvailableSourceId([sources[2]], "disabled", {}),
    null,
  );
});
