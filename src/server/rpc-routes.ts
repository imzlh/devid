import type { ServerContext } from "./context.ts";
import { M3U8Service } from "../utils/m3u8.ts";
import { pushSourceChange } from "../websocket/push.ts";

export function registerRpcHandlers(ctx: ServerContext): void {
  const { videoSourceManager, downloadManager, rpcServer } = ctx;

  rpcServer.register(
    "sources.getAll",
    () => videoSourceManager.getAllSources(),
  );

  rpcServer.register("sources.getHealth", () => ({
    health: videoSourceManager.getHealthStatus(),
    initialized: videoSourceManager.isInitialized(),
    activeSourceId: videoSourceManager.getActiveSourceId(),
  }));

  rpcServer.register("sources.reinit", async (...params: unknown[]) => {
    const sourceId = params[0] as string;
    const success = await videoSourceManager.initSource(sourceId);
    return {
      success,
      health: videoSourceManager.getHealthStatus()[sourceId],
    };
  });

  rpcServer.register("sources.getActive", () => {
    const activeSource = videoSourceManager.getActiveSource();
    const sourceId = videoSourceManager.getActiveSourceId();
    return {
      id: sourceId,
      name: activeSource?.getName() || null,
      imageAspectRatio: activeSource?.getImageAspectRatio() || "16/9",
    };
  });

  rpcServer.register("sources.setActive", (...params: unknown[]) => {
    const sourceId = params[0] as string;
    const success = videoSourceManager.setActiveSource(sourceId);
    if (success) {
      const newSource = videoSourceManager.getActiveSource();
      if (newSource) {
        pushSourceChange(newSource.getId(), newSource.getName());
      }
    }
    const activeSource = videoSourceManager.getActiveSource();
    return {
      success,
      id: activeSource?.getId(),
      name: activeSource?.getName(),
      imageAspectRatio: activeSource?.getImageAspectRatio() || "16/9",
    };
  });

  rpcServer.register("videos.getHome", (...params: unknown[]) => {
    const page = (params[0] as number) || 1;
    return videoSourceManager.getHomeVideos(page);
  });

  rpcServer.register("videos.search", (...params: unknown[]) => {
    const query = params[0] as string;
    const page = (params[1] as number) || 1;
    return videoSourceManager.searchVideos(query, page);
  });

  rpcServer.register("series.getDetail", async (...params: unknown[]) => {
    const seriesId = params[0] as string;
    const url = params[1] as string | undefined;
    const source = params[2] as string | undefined;
    const detail = await videoSourceManager.getSeries(
      seriesId,
      url || undefined,
      source || undefined,
    );
    if (!detail) throw new Error("系列不存在");
    return detail;
  });

  rpcServer.register("series.getVideos", async (...params: unknown[]) => {
    const seriesId = params[0] as string;
    const source = params[1] as string | undefined;
    const result = await videoSourceManager.getSeriesVideos(
      seriesId,
      source || undefined,
    );
    if (!result) throw new Error("系列不存在");
    return result;
  });

  rpcServer.register("videos.parse", async (...params: unknown[]) => {
    const url = params[0] as string;
    const source = params[1] as string | undefined;
    const results = await videoSourceManager.parseVideoUrl(
      url,
      source || undefined,
    );
    return { results };
  });

  rpcServer.register("m3u8.parse", async (...params: unknown[]) => {
    const url = params[0] as string;
    const results = await M3U8Service.fetchAndParseM3U8(url);
    return { results };
  });

  rpcServer.register("downloads.getAll", () => {
    return { tasks: downloadManager.getAllDownloadTasks() };
  });

  rpcServer.register("downloads.get", (...params: unknown[]) => {
    const taskId = params[0] as string;
    const task = downloadManager.getDownloadTask(taskId);
    if (!task) throw new Error("下载任务不存在");
    return { task };
  });

  rpcServer.register("downloads.create", (...params: unknown[]) => {
    const title = params[0] as string;
    const url = params[1] as string;
    const outputPath = params[2] as string | undefined;
    const referer = params[3] as string | undefined;
    const taskId = downloadManager.createDownloadTask(
      url,
      title,
      outputPath,
      referer,
    );
    const task = downloadManager.getDownloadTask(taskId);
    return { task };
  });

  rpcServer.register("downloads.start", (...params: unknown[]) => {
    const taskId = params[0] as string;
    const task = downloadManager.getDownloadTask(taskId);
    if (!task) throw new Error("下载任务不存在");
    if (task.status === "downloading") {
      return { success: true, message: "任务已在下载中" };
    }
    if (task.status === "completed") {
      return { success: true, message: "任务已下载完成" };
    }
    downloadManager.startDownload(taskId);
    return {
      success: true,
      message: "任务已加入下载队列",
      task: downloadManager.getDownloadTask(taskId),
    };
  });

  rpcServer.register("downloads.cancel", async (...params: unknown[]) => {
    const taskId = params[0] as string;
    const success = downloadManager.cancelDownload(taskId);
    if (success) {
      await downloadManager.saveToKV();
    }
    return { success };
  });

  rpcServer.register("downloads.retry", async (...params: unknown[]) => {
    const taskId = params[0] as string;
    const success = await downloadManager.retryDownload(taskId);
    return { success, task: downloadManager.getDownloadTask(taskId) };
  });

  rpcServer.register("downloads.delete", async (...params: unknown[]) => {
    const taskId = params[0] as string;
    const deleteFile = params[1] as boolean;
    const success = downloadManager.deleteDownload(taskId, deleteFile);
    if (success) {
      await downloadManager.saveToKV();
    }
    return { success };
  });

  rpcServer.register("downloads.getStats", () => {
    return {
      stats: downloadManager.getStats(),
      active: downloadManager.getActiveDownloads().length,
      pending: downloadManager.getPendingDownloads().length,
      queue: downloadManager.getAllDownloadTasks().length,
    };
  });

  rpcServer.register(
    "downloads.clearCompleted",
    async (...params: unknown[]) => {
      const deleteFiles = params[0] as boolean;
      const result = downloadManager.clearCompletedDownloads(deleteFiles);
      if (result.count > 0) {
        await downloadManager.saveToKV();
      }
      return {
        success: result.count > 0,
        clearedCount: result.count,
        deletedFiles: result.deletedFiles,
      };
    },
  );

  rpcServer.register("captcha.submit", async (...params: unknown[]) => {
    const requestId = params[0] as string;
    const answer = params[1] as string;
    const { resolveCaptcha } = await import("../utils/captcha.ts");
    const success = resolveCaptcha(requestId, answer);
    return { success };
  });

  rpcServer.register("captcha.cancel", async (...params: unknown[]) => {
    const requestId = params[0] as string;
    const reason = (params[1] as string) || "用户取消";
    const { cancelCaptcha } = await import("../utils/captcha.ts");
    const success = cancelCaptcha(requestId, reason);
    return { success };
  });

  rpcServer.register("health.get", () => {
    const sourcesHealth = videoSourceManager.getHealthStatus();
    const healthySources = Object.values(sourcesHealth).filter((h) =>
      h.status === "healthy"
    ).length;
    const totalSources = Object.keys(sourcesHealth).length;

    return {
      status: healthySources > 0 ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      uptime: performance.now(),
      sources: {
        total: totalSources,
        healthy: healthySources,
        initialized: videoSourceManager.isInitialized(),
      },
      downloads: {
        active: downloadManager.getActiveDownloads().length,
        pending: downloadManager.getPendingDownloads().length,
        total: downloadManager.getAllDownloadTasks().length,
      },
      wsClients: rpcServer.getClientCount(),
    };
  });
}
