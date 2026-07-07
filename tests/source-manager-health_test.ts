import { assertEquals } from "@std/assert";
import { VideoSourceManager } from "../src/manager.ts";
import { buildActiveSourceResponse } from "../src/server/source-response.ts";
import { BaseVideoSource } from "../src/sources/index.ts";
import type { IVideoList, IVideoURL } from "../src/types/index.ts";

class ToggleSource extends BaseVideoSource {
  failInit = false;

  constructor(id: string) {
    super(id, id, `https://${id}.example.test`);
  }

  init(): Promise<void> {
    if (this.failInit) throw new Error(`${this.getId()} failed`);
    return Promise.resolve();
  }

  getHomeVideos(): Promise<IVideoList> {
    return Promise.resolve({ videos: [], currentPage: 1, totalPages: 1 });
  }

  searchVideos(): Promise<IVideoList> {
    return Promise.resolve({ videos: [], currentPage: 1, totalPages: 1 });
  }

  parseVideoUrl(): Promise<IVideoURL[]> {
    return Promise.resolve([]);
  }
}

Deno.test("VideoSourceManager exposes failed source health and disables failed source", async () => {
  const manager = new VideoSourceManager();
  const source = new ToggleSource("test-reinit-fail");
  manager.registerSource(source);

  assertEquals(await manager.initSource(source.getId()), true);
  assertEquals(manager.setActiveSource(source.getId()), true);
  assertEquals(manager.getActiveSourceId(), source.getId());

  source.failInit = true;
  assertEquals(await manager.initSource(source.getId()), false);
  assertEquals(manager.getActiveSourceId(), null);
  assertEquals(manager.getSourceHealth(source.getId())?.status, "unhealthy");
  assertEquals(manager.getHealthStatus()[source.getId()]?.status, "unhealthy");
  assertEquals(manager.getSource(source.getId()), null);

  const listed = manager.getAllSources().find((item) =>
    item.id === source.getId()
  );
  assertEquals(listed?.enabled, false);
  assertEquals(listed?.health?.status, "unhealthy");
});

Deno.test("VideoSourceManager falls back to another healthy active source", async () => {
  const manager = new VideoSourceManager();
  const first = new ToggleSource("test-primary");
  const fallback = new ToggleSource("test-fallback");
  manager.registerSource(first);
  manager.registerSource(fallback);

  assertEquals(await manager.initSource(first.getId()), true);
  assertEquals(await manager.initSource(fallback.getId()), true);
  assertEquals(manager.setActiveSource(first.getId()), true);

  first.failInit = true;
  assertEquals(await manager.initSource(first.getId()), false);
  assertEquals(manager.getActiveSourceId(), fallback.getId());
  assertEquals(manager.getActiveSource()?.getId(), fallback.getId());
});

Deno.test("buildActiveSourceResponse returns stable REST RPC active source shape", async () => {
  const manager = new VideoSourceManager();
  assertEquals(buildActiveSourceResponse(manager), {
    id: null,
    name: null,
    imageAspectRatio: "16/9",
  });

  const source = new ToggleSource("test-active-response");
  manager.registerSource(source);
  assertEquals(await manager.initSource(source.getId()), true);
  assertEquals(manager.setActiveSource(source.getId()), true);
  assertEquals(buildActiveSourceResponse(manager), {
    id: "test-active-response",
    name: "test-active-response",
    imageAspectRatio: "16/9",
  });
});

Deno.test("VideoSourceManager trims active source ids before switching", async () => {
  const manager = new VideoSourceManager();
  const source = new ToggleSource("test-trimmed-source");
  manager.registerSource(source);
  assertEquals(await manager.initSource(source.getId()), true);

  assertEquals(manager.setActiveSource(` ${source.getId()} `), true);
  assertEquals(manager.getActiveSourceId(), source.getId());
  assertEquals(
    manager.getSource(` ${source.getId()} `)?.getId(),
    source.getId(),
  );
});

Deno.test("VideoSourceManager trims source ids before reinit and health lookup", async () => {
  const manager = new VideoSourceManager();
  const source = new ToggleSource("test-trimmed-health");
  manager.registerSource(source);

  assertEquals(await manager.initSource(` ${source.getId()} `), true);
  assertEquals(
    manager.getSourceHealth(` ${source.getId()} `)?.status,
    "healthy",
  );
});
