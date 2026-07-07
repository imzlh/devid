import { assertEquals, assertExists } from "@std/assert";
import { type IDownloadTaskPersisted, URLProxy } from "../src/types/index.ts";
import {
  DownloadManager,
  splitDownloadFileName,
  taskFilePathMatchesOutput,
} from "../src/utils/download.ts";

function createManager(): DownloadManager {
  return new DownloadManager({
    serverAddr: "http://127.0.0.1:9",
    autoProcess: false,
  });
}

Deno.test("DownloadManager creates tasks without auto-starting and preserves media metadata", () => {
  const manager = createManager();
  try {
    const id = manager.createDownloadTask(
      "https://cdn.example.test/video.mp4?token=1",
      "A/B: Episode?",
      "./downloads",
      "https://site.example.test/watch",
      { format: "h5", proxy: URLProxy.NONE },
    );

    const task = manager.getDownloadTask(id);
    assertExists(task);
    assertEquals(task.status, "pending");
    assertEquals(task.progress, 0);
    assertEquals(task.format, "h5");
    assertEquals(task.proxy, URLProxy.NONE);
    assertEquals(task.referer, "https://site.example.test/watch");
    assertEquals(task.fileName, "A_B_ Episode_.mp4");
    assertEquals(manager.getPendingDownloads().map((item) => item.id), [id]);
    assertEquals(manager.exportTasks()[0].queued, false);
  } finally {
    manager.stopCleanupTimer();
  }
});

Deno.test("DownloadManager normalizes created task titles before storing", () => {
  const manager = createManager();
  try {
    const id = manager.createDownloadTask(
      "https://cdn.example.test/video.mp4",
      "  Episode 1  ",
    );

    const task = manager.getDownloadTask(id);
    assertExists(task);
    assertEquals(task.title, "Episode 1");
    assertEquals(task.fileName, "Episode 1.mp4");

    const unnamedId = manager.createDownloadTask(
      "https://cdn.example.test/other.mp4",
      "   ",
    );
    const unnamed = manager.getDownloadTask(unnamedId);
    assertExists(unnamed);
    assertEquals(unnamed.title, "未命名下载");
    assertEquals(unnamed.fileName, "未命名下载.mp4");
  } finally {
    manager.stopCleanupTimer();
  }
});

Deno.test("DownloadManager rejects player pages mislabelled as H5", () => {
  const manager = createManager();
  try {
    let message = "";
    try {
      manager.createDownloadTask(
        "https://site.example.test/watch?id=1",
        "Page",
        "./downloads",
        undefined,
        { format: "h5", proxy: URLProxy.NONE },
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    assertEquals(
      message,
      "下载URL不是直连媒体地址: https://site.example.test/watch?id=1",
    );
  } finally {
    manager.stopCleanupTimer();
  }
});

Deno.test("DownloadManager does not let weak H5 hints override m3u8 URLs", () => {
  const manager = createManager();
  try {
    const id = manager.createDownloadTask(
      "https://cdn.example.test/live/index.m3u8",
      "Live",
      "./downloads",
      undefined,
      { format: "h5", proxy: URLProxy.NONE },
    );

    const task = manager.getDownloadTask(id);
    assertExists(task);
    assertEquals(task.format, "m3u8");
    assertEquals(task.proxy, URLProxy.NONE);
  } finally {
    manager.stopCleanupTimer();
  }
});

Deno.test("DownloadManager falls back to safe output path for unsafe configured paths", () => {
  const manager = createManager();
  try {
    const id = manager.createDownloadTask(
      "https://cdn.example.test/video.mp4",
      "Unsafe Path",
      "http://example.test/output",
    );

    const task = manager.getDownloadTask(id);
    assertExists(task);
    assertEquals(task.outputPath, "./downloads");
    assertEquals(task.filePath, "./downloads/Unsafe Path.mp4");
  } finally {
    manager.stopCleanupTimer();
  }
});

Deno.test("DownloadManager cancel retry delete transitions stay explicit", () => {
  const manager = createManager();
  try {
    const id = manager.createDownloadTask(
      "https://cdn.example.test/live/index.m3u8",
      "Live",
    );

    assertEquals(manager.cancelDownload("missing"), false);
    assertEquals(manager.cancelDownload(id), true);
    assertEquals(manager.getDownloadTask(id)?.status, "cancelled");
    assertEquals(manager.cancelDownload(id), true);
    assertEquals(manager.getStats().cancelledDownloads, 1);

    assertEquals(manager.retryDownload(id), true);
    assertEquals(manager.getDownloadTask(id)?.status, "pending");
    assertEquals(manager.getDownloadTask(id)?.progress, 0);
    assertEquals(manager.exportTasks()[0].queued, true);

    assertEquals(manager.deleteDownload("missing"), false);
    assertEquals(manager.deleteDownload(id), true);
    assertEquals(manager.getDownloadTask(id), undefined);
  } finally {
    manager.stopCleanupTimer();
  }
});

Deno.test("DownloadManager normalizes task ids across public controls", () => {
  const manager = createManager();
  try {
    const id = manager.createDownloadTask(
      "https://cdn.example.test/live/index.m3u8",
      "Trimmed Controls",
    );
    const spacedId = `  ${id}  `;

    assertExists(manager.getDownloadTask(spacedId));
    assertEquals(manager.startDownload(spacedId), true);
    assertEquals(manager.exportTasks()[0].queued, true);
    assertEquals(manager.getQueuePosition(spacedId), 1);

    manager.setProgress(spacedId, 0.25);
    assertEquals(manager.getDownloadTask(id)?.progress, 25);

    assertEquals(manager.cancelDownload(spacedId), true);
    assertEquals(manager.getDownloadTask(id)?.status, "cancelled");

    assertEquals(manager.retryDownload(spacedId), true);
    assertEquals(manager.getDownloadTask(id)?.status, "pending");

    assertEquals(manager.deleteDownload(spacedId), true);
    assertEquals(manager.getDownloadTask(id), undefined);
  } finally {
    manager.stopCleanupTimer();
  }
});

Deno.test("DownloadManager clear completed reports zero clears explicitly", () => {
  const manager = createManager();
  try {
    assertEquals(manager.clearCompletedDownloads(), {
      count: 0,
      deletedFiles: 0,
    });

    const activeId = manager.createDownloadTask(
      "https://cdn.example.test/video.mp4",
      "Active",
    );
    assertEquals(manager.clearCompletedDownloads(), {
      count: 0,
      deletedFiles: 0,
    });
    assertExists(manager.getDownloadTask(activeId));

    assertEquals(manager.cancelDownload(activeId), true);
    assertEquals(manager.clearCompletedDownloads(), {
      count: 1,
      deletedFiles: 0,
    });
    assertEquals(manager.getDownloadTask(activeId), undefined);
  } finally {
    manager.stopCleanupTimer();
  }
});

Deno.test("DownloadManager progress markers reject non-finite values", () => {
  const manager = createManager();
  try {
    const id = manager.createDownloadTask(
      "https://cdn.example.test/live/index.m3u8",
      "Progress",
    );

    manager.setProgress(id, 0.5);
    assertEquals(manager.getDownloadTask(id)?.progress, 50);

    manager.setProgress(id, Number.NaN);
    assertEquals(manager.getDownloadTask(id)?.progress, 50);

    manager.setProgress(id, Number.POSITIVE_INFINITY);
    assertEquals(manager.getDownloadTask(id)?.progress, 50);

    manager.markStart(id, Number.NaN);
    assertEquals(manager.getDownloadTask(id)?.totalSegments, undefined);

    manager.markStart(id, 3.8);
    assertEquals(manager.getDownloadTask(id)?.totalSegments, 3);
    manager.markStep(id);
    assertEquals(manager.getDownloadTask(id)?.progress, 50 + 100 / 3);
  } finally {
    manager.stopCleanupTimer();
  }
});

Deno.test("DownloadManager import normalizes unsafe persisted tasks and restores only queued pending tasks", () => {
  const manager = createManager();
  try {
    const tasks: IDownloadTaskPersisted[] = [
      {
        id: "bad-url",
        url: "javascript:alert(1)",
        title: "bad",
        outputPath: "../escape",
        filePath: "../escape/bad.mp4",
        fileName: "../bad.mp4",
        status: "pending",
        progress: 50,
        createTime: "bad date",
      },
      {
        id: "queued",
        url: "https://cdn.example.test/media/master.m3u8",
        referer: "notaurl",
        format: "h5",
        proxy: 999 as URLProxy,
        queued: true,
        title: "",
        outputPath: "../escape",
        filePath: "../escape/evil.mp4",
        fileName: "../evil.mp4",
        status: "pending",
        progress: 250,
        createTime: "bad date",
      },
      {
        id: "interrupted",
        url: "https://cdn.example.test/video.mp4",
        queued: true,
        title: "Interrupted",
        outputPath: "./downloads",
        filePath: "./downloads/interrupted.mp4",
        fileName: "interrupted.mp4",
        status: "downloading",
        progress: 80,
        createTime: new Date("2026-01-01T00:00:00Z").toISOString(),
      },
    ];

    manager.importTasks(tasks);

    assertEquals(manager.getDownloadTask("bad-url"), undefined);

    const queued = manager.getDownloadTask("queued");
    assertExists(queued);
    assertEquals(queued.title, "未命名下载");
    assertEquals(queued.outputPath, "./downloads");
    assertEquals(queued.filePath, "./downloads/_evil.mp4");
    assertEquals(queued.referer, undefined);
    assertEquals(queued.format, "m3u8");
    assertEquals(queued.proxy, undefined);
    assertEquals(queued.progress, 100);
    assertEquals(
      manager.exportTasks().find((task) => task.id === "queued")?.queued,
      true,
    );

    const interrupted = manager.getDownloadTask("interrupted");
    assertExists(interrupted);
    assertEquals(interrupted.status, "error");
    assertEquals(interrupted.error, "程序重启，任务中断");
    assertEquals(interrupted.progress, 0);
    assertEquals(
      manager.exportTasks().find((task) => task.id === "interrupted")?.queued,
      false,
    );
  } finally {
    manager.stopCleanupTimer();
  }
});

Deno.test("DownloadManager import checks duplicates after trimming task ids", () => {
  const manager = createManager();
  try {
    manager.importTasks([
      {
        id: "duplicate",
        url: "https://cdn.example.test/original.mp4",
        title: "Original",
        outputPath: "./downloads",
        filePath: "./downloads/original.mp4",
        fileName: "original.mp4",
        status: "pending",
        progress: 10,
        createTime: new Date("2026-01-01T00:00:00Z").toISOString(),
      },
      {
        id: " duplicate ",
        url: "https://cdn.example.test/replacement.mp4",
        title: "Replacement",
        outputPath: "./downloads",
        filePath: "./downloads/replacement.mp4",
        fileName: "replacement.mp4",
        status: "pending",
        progress: 90,
        createTime: new Date("2026-01-02T00:00:00Z").toISOString(),
      },
    ]);

    const task = manager.getDownloadTask("duplicate");
    assertExists(task);
    assertEquals(task.title, "Original");
    assertEquals(task.url, "https://cdn.example.test/original.mp4");
    assertEquals(manager.exportTasks().length, 1);
  } finally {
    manager.stopCleanupTimer();
  }
});

Deno.test("DownloadManager import ignores malformed task lists", () => {
  const manager = createManager();
  try {
    manager.importTasks({ bad: true });
    manager.importTasks(null);
    assertEquals(manager.exportTasks(), []);
  } finally {
    manager.stopCleanupTimer();
  }
});

Deno.test("DownloadManager import normalizes persisted retry metadata", () => {
  const manager = createManager();
  try {
    manager.importTasks([
      {
        id: "retry-metadata",
        url: "https://cdn.example.test/video.mp4",
        title: "Retry Metadata",
        outputPath: "./downloads",
        filePath: "./downloads/retry.mp4",
        fileName: "retry.mp4",
        status: "error",
        progress: 33,
        createTime: new Date("2026-01-01T00:00:00Z").toISOString(),
        error: { message: "bad" },
        retryCount: "bad",
        maxRetries: -1,
        totalSegments: "3",
      },
    ]);

    const task = manager.getDownloadTask("retry-metadata");
    assertExists(task);
    assertEquals(task.error, undefined);
    assertEquals(task.retryCount, 0);
    assertEquals(task.maxRetries, 2);
    assertEquals(task.totalSegments, 3);
  } finally {
    manager.stopCleanupTimer();
  }
});

Deno.test("splitDownloadFileName handles persisted names without extensions", () => {
  assertEquals(splitDownloadFileName("clip"), {
    base: "clip",
    extension: "",
  });
  assertEquals(splitDownloadFileName("clip.mp4"), {
    base: "clip",
    extension: ".mp4",
  });
  assertEquals(splitDownloadFileName("archive.tar.gz"), {
    base: "archive.tar",
    extension: ".gz",
  });
  assertEquals(splitDownloadFileName(""), {
    base: "unnamed",
    extension: "",
  });
});

Deno.test("taskFilePathMatchesOutput only allows deleting the task output file", () => {
  assertEquals(
    taskFilePathMatchesOutput({
      outputPath: "./downloads",
      fileName: "clip.mp4",
      filePath: "./downloads/clip.mp4",
    }),
    true,
  );
  assertEquals(
    taskFilePathMatchesOutput({
      outputPath: "./downloads",
      fileName: "clip.mp4",
      filePath: "./downloads/../config.json",
    }),
    false,
  );
  assertEquals(
    taskFilePathMatchesOutput({
      outputPath: "./downloads",
      fileName: "clip.mp4",
      filePath: "./downloads/other.mp4",
    }),
    false,
  );
  assertEquals(
    taskFilePathMatchesOutput({
      outputPath: "./downloads",
      fileName: "clip.mp4",
      filePath: "/tmp/clip.mp4",
    }),
    false,
  );
});
