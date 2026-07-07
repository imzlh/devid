import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { M3U8Parser, M3U8Service } from "../src/utils/m3u8.ts";

Deno.test("M3U8 parser rejects non-playlist content before type detection", () => {
  assertEquals(
    M3U8Parser.isPlaylistContent("\uFEFF  #EXTM3U\n#EXTINF:6,"),
    true,
  );
  assertEquals(
    M3U8Parser.isPlaylistContent("<html>not a playlist</html>"),
    false,
  );
  assertThrows(
    () => M3U8Parser.identifyPlaylistType("<html>not a playlist</html>"),
    Error,
    "不是有效的 M3U8 播放列表",
  );
});

Deno.test("M3U8 proxy serialization rewrites master playlist variants with m3u8 type", () => {
  const parser = new M3U8Parser("https://cdn.example.test/master/index.m3u8");
  const manifest = parser.parseMasterPlaylist(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
low/playlist.m3u8
#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=120000,URI="iframe.m3u8"
`);

  const rewritten = M3U8Service.serializeManifest(manifest, {
    taskId: "task-1",
    referer: "https://site.example.test/watch",
  });

  assertStringIncludes(rewritten, "/api/proxy/m3u8?");
  assertStringIncludes(rewritten, "type=m3u8");
  assertStringIncludes(rewritten, "taskId=task-1");
  assertStringIncludes(
    rewritten,
    "referer=https%3A%2F%2Fsite.example.test%2Fwatch",
  );
  assertStringIncludes(
    rewritten,
    "url=https%3A%2F%2Fcdn.example.test%2Fmaster%2Flow%2Fplaylist.m3u8",
  );
  assertStringIncludes(
    rewritten,
    'URI="/api/proxy/m3u8?url=https%3A%2F%2Fcdn.example.test%2Fmaster%2Fiframe.m3u8&type=m3u8',
  );
});

Deno.test("M3U8 serialization preserves zero media sequence", () => {
  const parser = new M3U8Parser("https://cdn.example.test/live/index.m3u8");
  const manifest = parser.parseMediaPlaylist(`#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:6,
seg0.ts
#EXT-X-ENDLIST
`);

  const rewritten = M3U8Service.serializeManifest(manifest);
  assertStringIncludes(rewritten, "#EXT-X-MEDIA-SEQUENCE:0");
});

Deno.test("M3U8 proxy serialization rewrites media playlist keys maps and segments", () => {
  const parser = new M3U8Parser("https://cdn.example.test/live/media.m3u8");
  const manifest = parser.parseMediaPlaylist(`#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:8
#EXT-X-MEDIA-SEQUENCE:10
#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x0000000000000000000000000000000a
#EXT-X-MAP:URI="init.mp4",BYTERANGE="720@0"
#EXTINF:7.5,
seg-10.ts
#EXTINF:7.5,
https://other.example.test/seg-11.m4s
#EXT-X-ENDLIST
`);

  const rewritten = M3U8Service.serializeManifest(manifest, {
    taskId: "task-2",
    proxy: "remote",
  });

  assertStringIncludes(
    rewritten,
    '#EXT-X-KEY:METHOD=AES-128,URI="/api/proxy/key?',
  );
  assertStringIncludes(rewritten, "type=key");
  assertStringIncludes(rewritten, '#EXT-X-MAP:URI="/api/proxy/map?');
  assertStringIncludes(rewritten, "type=map");
  assertStringIncludes(rewritten, "/api/proxy/chunk.ts?");
  assertStringIncludes(rewritten, "type=ts");
  assertStringIncludes(rewritten, "/api/proxy/seg-11.m4s?");
  assertStringIncludes(rewritten, "type=segment");
  assertStringIncludes(rewritten, "taskId=task-2");
  assertStringIncludes(rewritten, "proxy=remote");
  assertEquals(rewritten.trim().endsWith("#EXT-X-ENDLIST"), true);

  const proxyUrls = [...rewritten.matchAll(/\/api\/proxy\/[^"\n]+/g)].map((
    match,
  ) => match[0]);
  assert(proxyUrls.length >= 4);
  for (const proxyUrl of proxyUrls) {
    const parsed = new URL(proxyUrl, "https://local.example.test");
    assert(parsed.searchParams.get("url")?.startsWith("http"));
  }
});
