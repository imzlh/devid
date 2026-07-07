import type { ServerContext } from "./context.ts";
import { M3U8Service } from "../utils/m3u8.ts";
import { pushSourceChange } from "../websocket/push.ts";
import {
  normalizeDownloadFormatInput,
  normalizeUrlProxyInput,
  optionalTrimmedString,
  validatePagination,
  validateRequiredString,
  validateUrl,
} from "../utils/validation.ts";
import { buildActiveSourceResponse } from "./source-response.ts";

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
    if (!validateRequiredString(sourceId, "sourceId")) {
      throw new Error("缺少或无效的视频源ID");
    }
    const normalizedSourceId = optionalTrimmedString(sourceId) as string;
    const success = await videoSourceManager.initSource(normalizedSourceId);
    return {
      success,
      health: videoSourceManager.getSourceHealth(normalizedSourceId),
      activeSourceId: videoSourceManager.getActiveSourceId(),
    };
  });

  rpcServer.register("sources.getActive", () => {
    return buildActiveSourceResponse(videoSourceManager);
  });

  rpcServer.register("sources.setActive", (...params: unknown[]) => {
    const sourceId = params[0] as string;
    if (!validateRequiredString(sourceId, "source")) {
      throw new Error("缺少或无效的source参数");
    }
    const normalizedSourceId = optionalTrimmedString(sourceId) as string;
    const success = videoSourceManager.setActiveSource(normalizedSourceId);
    if (success) {
      const newSource = videoSourceManager.getActiveSource();
      if (newSource) {
        pushSourceChange(newSource.getId(), newSource.getName());
      }
    }
    return {
      success,
      ...buildActiveSourceResponse(videoSourceManager),
    };
  });

  rpcServer.register("videos.getHome", (...params: unknown[]) => {
    const page = params[0] ?? 1;
    if (!validatePagination(page)) {
      throw new Error("无效的分页参数");
    }
    return videoSourceManager.getHomeVideos(Number(page));
  });

  rpcServer.register("videos.search", (...params: unknown[]) => {
    const query = params[0] as string;
    const page = params[1] ?? 1;
    if (!validateRequiredString(query, "query")) {
      throw new Error("缺少或无效的搜索查询");
    }
    if (!validatePagination(page)) {
      throw new Error("无效的分页参数");
    }
    return videoSourceManager.searchVideos(query.trim(), Number(page));
  });

  rpcServer.register("series.getDetail", async (...params: unknown[]) => {
    const seriesId = params[0] as string;
    const url = params[1] as string | undefined;
    const source = optionalTrimmedString(params[2]);
    if (
      !validateRequiredString(seriesId, "seriesId") && !validateUrl(url || "")
    ) {
      throw new Error("缺少系列ID或URL");
    }
    if (url && !validateUrl(url)) {
      throw new Error("无效的系列URL");
    }
    const detail = await videoSourceManager.getSeries(
      optionalTrimmedString(seriesId) || seriesId,
      optionalTrimmedString(url),
      source,
    );
    if (!detail) throw new Error("系列不存在");
    return detail;
  });

  rpcServer.register("series.getVideos", async (...params: unknown[]) => {
    const seriesId = params[0] as string;
    const source = optionalTrimmedString(params[1]);
    if (!validateRequiredString(seriesId, "seriesId")) {
      throw new Error("缺少或无效的系列ID");
    }
    const result = await videoSourceManager.getSeriesVideos(
      optionalTrimmedString(seriesId) || seriesId,
      source,
    );
    if (!result) throw new Error("系列不存在");
    return result;
  });

  rpcServer.register("videos.parse", async (...params: unknown[]) => {
    const url = params[0] as string;
    const source = optionalTrimmedString(params[1]);
    if (!validateUrl(url)) {
      throw new Error("缺少或无效的URL参数");
    }
    const results = await videoSourceManager.parseVideoUrl(
      url.trim(),
      source,
    );
    return { results };
  });

  rpcServer.register("m3u8.parse", async (...params: unknown[]) => {
    const url = params[0] as string;
    if (!validateUrl(url)) {
      throw new Error("缺少或无效的URL参数");
    }
    const results = await M3U8Service.fetchAndParseM3U8(url.trim());
    return { results };
  });

  rpcServer.register("downloads.getAll", () => {
    return { tasks: downloadManager.getAllDownloadTasks() };
  });

  rpcServer.register("downloads.get", (...params: unknown[]) => {
    const taskId = params[0] as string;
    if (!validateRequiredString(taskId, "taskId")) {
      throw new Error("缺少或无效的任务ID");
    }
    const normalizedTaskId = optionalTrimmedString(taskId) as string;
    const task = downloadManager.getDownloadTask(normalizedTaskId);
    if (!task) throw new Error("下载任务不存在");
    return { task };
  });

  rpcServer.register("downloads.create", async (...params: unknown[]) => {
    const title = params[0] as string;
    const url = params[1] as string;
    const outputPath = params[2] as string | undefined;
    const referer = params[3] as string | undefined;
    const format = params[4] as "m3u8" | "h5" | undefined;
    const proxy = params[5] as number | undefined;
    if (!validateRequiredString(title, "title")) {
      throw new Error("缺少或无效的标题");
    }
    if (!validateUrl(url)) {
      throw new Error("无效的下载URL");
    }
    const taskId = downloadManager.createDownloadTask(
      url.trim(),
      title,
      optionalTrimmedString(outputPath),
      optionalTrimmedString(referer),
      {
        format: normalizeDownloadFormatInput(format),
        proxy: normalizeUrlProxyInput(proxy),
      },
    );
    const task = downloadManager.getDownloadTask(taskId);
    await downloadManager.saveToKV();
    return { task };
  });

  rpcServer.register("downloads.start", async (...params: unknown[]) => {
    const taskId = params[0] as string;
    if (!validateRequiredString(taskId, "taskId")) {
      throw new Error("缺少或无效的任务ID");
    }
    const normalizedTaskId = optionalTrimmedString(taskId) as string;
    const task = downloadManager.getDownloadTask(normalizedTaskId);
    if (!task) throw new Error("下载任务不存在");
    if (task.status === "downloading") {
      return { success: true, message: "任务已在下载中" };
    }
    if (task.status === "completed") {
      return { success: true, message: "任务已下载完成" };
    }
    downloadManager.startDownload(normalizedTaskId);
    await downloadManager.saveToKV();
    return {
      success: true,
      message: "任务已加入下载队列",
      task: downloadManager.getDownloadTask(normalizedTaskId),
    };
  });

  rpcServer.register("downloads.cancel", async (...params: unknown[]) => {
    const taskId = params[0] as string;
    if (!validateRequiredString(taskId, "taskId")) {
      throw new Error("缺少或无效的任务ID");
    }
    const normalizedTaskId = optionalTrimmedString(taskId) as string;
    const task = downloadManager.getDownloadTask(normalizedTaskId);
    if (!task) throw new Error("下载任务不存在");
    const success = downloadManager.cancelDownload(normalizedTaskId);
    if (success) {
      await downloadManager.saveToKV();
    }
    return { success };
  });

  rpcServer.register("downloads.retry", async (...params: unknown[]) => {
    const taskId = params[0] as string;
    if (!validateRequiredString(taskId, "taskId")) {
      throw new Error("缺少或无效的任务ID");
    }
    const normalizedTaskId = optionalTrimmedString(taskId) as string;
    const task = downloadManager.getDownloadTask(normalizedTaskId);
    if (!task) throw new Error("下载任务不存在");
    const success = await downloadManager.retryDownload(normalizedTaskId);
    if (success) {
      await downloadManager.saveToKV();
    }
    return { success, task: downloadManager.getDownloadTask(normalizedTaskId) };
  });

  rpcServer.register("downloads.delete", async (...params: unknown[]) => {
    const taskId = params[0] as string;
    const deleteFile = params[1] as boolean;
    if (!validateRequiredString(taskId, "taskId")) {
      throw new Error("缺少或无效的任务ID");
    }
    const normalizedTaskId = optionalTrimmedString(taskId) as string;
    const task = downloadManager.getDownloadTask(normalizedTaskId);
    if (!task) throw new Error("下载任务不存在");
    const success = downloadManager.deleteDownload(
      normalizedTaskId,
      deleteFile,
    );
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
        success: true,
        clearedCount: result.count,
        deletedFiles: result.deletedFiles,
      };
    },
  );

  rpcServer.register("captcha.submit", async (...params: unknown[]) => {
    const requestId = params[0] as string;
    const answer = params[1] as string;
    if (
      !validateRequiredString(requestId, "requestId") ||
      !validateRequiredString(answer, "answer")
    ) {
      throw new Error("缺少或无效的验证码参数");
    }
    const { resolveCaptcha } = await import("../utils/captcha.ts");
    const success = resolveCaptcha(
      optionalTrimmedString(requestId) as string,
      optionalTrimmedString(answer) as string,
    );
    return { success };
  });

  rpcServer.register("captcha.cancel", async (...params: unknown[]) => {
    const requestId = params[0] as string;
    const reason = optionalTrimmedString(params[1]) || "用户取消";
    if (!validateRequiredString(requestId, "requestId")) {
      throw new Error("缺少或无效的requestId");
    }
    const { cancelCaptcha } = await import("../utils/captcha.ts");
    const success = cancelCaptcha(
      optionalTrimmedString(requestId) as string,
      reason,
    );
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
