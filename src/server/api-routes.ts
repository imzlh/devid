import type { Hono } from "hono";
import type { ServerContext } from "./context.ts";
import { M3U8Service } from "../utils/m3u8.ts";
import { fetch2, imagePayloadError } from "../utils/fetch.ts";
import { logDebug, logError, logInfo, logWarn } from "../utils/logger.ts";
import {
  normalizeDownloadFormatInput,
  normalizeUrlProxyInput,
  optionalTrimmedString,
  validatePagination,
  validateRequiredFields,
  validateRequiredString,
  validateUrl,
} from "../utils/validation.ts";
import { pushSourceChange } from "../websocket/push.ts";
import { buildActiveSourceResponse } from "./source-response.ts";

async function readJsonObject(
  c: { req: { json(): Promise<unknown> } },
): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function registerApiRoutes(app: Hono, ctx: ServerContext): void {
  const { videoSourceManager, downloadManager, rpcServer } = ctx;

  app.get("/api/sources", (c) => {
    logDebug("获取所有视频源");
    return c.json(videoSourceManager.getAllSources());
  });

  app.get("/api/sources/health", (c) => {
    logDebug("获取视频源健康状态");
    return c.json({
      health: videoSourceManager.getHealthStatus(),
      initialized: videoSourceManager.isInitialized(),
      activeSourceId: videoSourceManager.getActiveSourceId(),
    });
  });

  app.post("/api/sources/:id/reinit", async (c) => {
    try {
      const sourceId = c.req.param("id");
      if (!validateRequiredString(sourceId, "sourceId")) {
        return c.json({ error: "缺少或无效的视频源ID" }, 400);
      }
      const normalizedSourceId = optionalTrimmedString(sourceId) as string;

      logInfo(`重新初始化视频源: ${normalizedSourceId}`);
      const success = await videoSourceManager.initSource(normalizedSourceId);
      return c.json({
        success,
        health: videoSourceManager.getSourceHealth(normalizedSourceId),
        activeSourceId: videoSourceManager.getActiveSourceId(),
      });
    } catch (error) {
      logError("重新初始化视频源失败:", error);
      return c.json({ error: "重新初始化失败" }, 500);
    }
  });

  app.post("/api/sources/active", async (c) => {
    try {
      const body = await readJsonObject(c);
      if (!body) return c.json({ error: "无效的请求体" }, 400);
      const { id: sourceId } = body;

      if (!validateRequiredString(sourceId, "source")) {
        logWarn("设置活动视频源失败: 缺少或无效的source参数");
        return c.json({ error: "缺少或无效的source参数" }, 400);
      }

      const activeSourceId = optionalTrimmedString(sourceId) as string;
      logDebug(`设置活动视频源: ${activeSourceId}`);
      const success = videoSourceManager.setActiveSource(activeSourceId);
      if (success) {
        logInfo(`成功设置活动视频源: ${activeSourceId}`);
        const newSource = videoSourceManager.getActiveSource();
        if (newSource) {
          pushSourceChange(newSource.getId(), newSource.getName());
        }
      } else {
        logWarn(`设置活动视频源失败: ${activeSourceId}`);
      }
      return c.json({
        success,
        ...buildActiveSourceResponse(videoSourceManager),
      });
    } catch (error) {
      logError("设置活动视频源请求处理失败:", error);
      return c.json({ error: "请求处理失败" }, 500);
    }
  });

  app.get("/api/sources/active", (c) => {
    logDebug("获取当前活动视频源");
    return c.json(buildActiveSourceResponse(videoSourceManager));
  });

  app.get("/api/home-videos", async (c) => {
    try {
      const pageParam = c.req.query("page") || "1";
      if (!validatePagination(pageParam)) {
        logWarn("获取主页视频失败: 无效的分页参数");
        return c.json({ error: "无效的分页参数" }, 400);
      }

      const page = Number(pageParam);
      logDebug(`获取主页视频, page: ${page}`);
      const result = await videoSourceManager.getHomeVideos(page);
      logInfo(
        `获取到 ${result.videos.length} 个主页视频, 当前页: ${result.currentPage}, 总页数: ${result.totalPages}`,
      );
      return c.json(result);
    } catch (error) {
      logError("获取主页视频失败:", error);
      return c.json({ error: "获取主页视频失败" }, 500);
    }
  });

  app.get("/api/search", async (c) => {
    try {
      const query = c.req.query("q") || "";
      const pageParam = c.req.query("page") || "1";

      if (!validateRequiredString(query, "query")) {
        logWarn("搜索视频失败: 缺少或无效的搜索查询");
        return c.json({ error: "缺少或无效的搜索查询" }, 400);
      }

      if (!validatePagination(pageParam)) {
        logWarn("搜索视频失败: 无效的分页参数");
        return c.json({ error: "无效的分页参数" }, 400);
      }

      const page = Number(pageParam);
      const searchQuery = query.trim();
      logDebug(`搜索视频: ${searchQuery}, page: ${page}`);
      const results = await videoSourceManager.searchVideos(searchQuery, page);
      logInfo(`搜索到 ${results.videos.length} 个视频`);
      return c.json(results);
    } catch (error) {
      logError("搜索视频失败:", error);
      return c.json({ error: "搜索视频失败" }, 500);
    }
  });

  app.get("/api/series/:id", async (c) => {
    try {
      const seriesId = c.req.param("id");
      const url = c.req.query("url");
      const source = optionalTrimmedString(c.req.query("source"));

      if (
        !validateRequiredString(seriesId, "seriesId") && !validateUrl(url || "")
      ) {
        return c.json({ error: "缺少系列ID或URL" }, 400);
      }
      if (url && !validateUrl(url)) {
        return c.json({ error: "无效的系列URL" }, 400);
      }

      const normalizedSeriesId = optionalTrimmedString(seriesId) || seriesId;
      logDebug(`获取系列详情: ${normalizedSeriesId}`);
      const detail = await videoSourceManager.getSeries(
        normalizedSeriesId,
        optionalTrimmedString(url),
        source,
      );
      if (!detail) {
        return c.json({ error: "系列不存在" }, 404);
      }

      return c.json(detail);
    } catch (error) {
      logError("获取系列详情失败:", error);
      return c.json({ error: "获取系列详情失败" }, 500);
    }
  });

  app.get("/api/series/:id/videos", async (c) => {
    try {
      const seriesId = c.req.param("id");
      const source = optionalTrimmedString(c.req.query("source"));
      const page = Number(c.req.query("page") ?? 1);
      if (!validateRequiredString(seriesId, "seriesId")) {
        return c.json({ error: "缺少系列ID" }, 400);
      }
      const normalizedSeriesId = optionalTrimmedString(seriesId) as string;

      logDebug(`获取无限系列视频: ${normalizedSeriesId}`);
      const result = await videoSourceManager.getSeriesVideos(
        normalizedSeriesId,
        source,
        Number.isSafeInteger(page) && page > 0 ? page : 1,
      );
      if (!result) {
        return c.json({ error: "系列不存在" }, 404);
      }

      return c.json(result);
    } catch (error) {
      logError("获取无限系列视频失败:", error);
      return c.json({ error: "获取无限系列视频失败" }, 500);
    }
  });

  app.post("/api/parse-video", async (c) => {
    try {
      const body = await readJsonObject(c);
      if (!body) return c.json({ error: "无效的请求体" }, 400);
      const { url, source } = body;

      if (!validateUrl(url)) {
        logWarn("解析视频链接失败: 缺少或无效的URL参数");
        return c.json({ error: "缺少或无效的URL参数" }, 400);
      }
      const targetUrl = (url as string).trim();

      logDebug(`解析视频链接: ${targetUrl}`);

      const videoUrls = await videoSourceManager.parseVideoUrl(
        targetUrl,
        optionalTrimmedString(source),
      );
      logInfo(`解析视频链接成功，获取到 ${videoUrls.length} 个结果`);
      return c.json({ results: videoUrls });
    } catch (error) {
      logError("解析视频链接失败:", error);
      return c.json({ error: "解析视频链接失败" }, 500);
    }
  });

  app.get("/api/parse-m3u8", async (c) => {
    try {
      const url = c.req.query("url");

      if (!url || !validateUrl(url)) {
        logWarn("解析M3U8失败: 缺少或无效的URL参数");
        return c.json({ error: "缺少或无效的URL参数" }, 400);
      }
      const targetUrl = url.trim();

      logDebug(`解析M3U8: ${targetUrl}`);
      const results = await M3U8Service.fetchAndParseM3U8(targetUrl);
      logInfo(`成功解析M3U8，获取到 ${results.length} 个结果`);
      return c.json({ results });
    } catch (error) {
      logError("解析M3U8失败:", error);
      return c.json({ error: "解析M3U8失败" }, 500);
    }
  });

  app.post("/api/captcha/submit", async (c) => {
    try {
      const body = await readJsonObject(c);
      if (!body) return c.json({ error: "无效的请求体" }, 400);
      const { requestId, answer } = body;

      if (!validateRequiredString(requestId, "requestId")) {
        logWarn("提交验证码失败: 缺少或无效的requestId");
        return c.json({ error: "缺少或无效的requestId" }, 400);
      }

      if (!validateRequiredString(answer, "answer")) {
        logWarn("提交验证码失败: 缺少或无效的answer");
        return c.json({ error: "缺少或无效的answer" }, 400);
      }

      const captchaRequestId = optionalTrimmedString(requestId) as string;
      const captchaAnswer = optionalTrimmedString(answer) as string;
      logDebug(`提交验证码答案: requestId=${captchaRequestId}`);
      const { resolveCaptcha } = await import("../utils/captcha.ts");
      const success = resolveCaptcha(captchaRequestId, captchaAnswer);
      if (success) {
        logInfo(`验证码答案已提交: ${captchaRequestId}`);
      } else {
        logWarn(`验证码答案提交失败: ${captchaRequestId}`);
      }

      return c.json({ success });
    } catch (error) {
      logError("提交验证码失败:", error);
      return c.json({ error: "提交验证码失败" }, 500);
    }
  });

  app.post("/api/captcha/cancel", async (c) => {
    try {
      const body = await readJsonObject(c);
      if (!body) return c.json({ error: "无效的请求体" }, 400);
      const { requestId, reason } = body;

      if (!validateRequiredString(requestId, "requestId")) {
        logWarn("取消验证码失败: 缺少或无效的requestId");
        return c.json({ error: "缺少或无效的requestId" }, 400);
      }

      const captchaRequestId = optionalTrimmedString(requestId) as string;
      const cancelReason = optionalTrimmedString(reason) || "用户取消";
      logDebug(
        `取消验证码请求: requestId=${captchaRequestId}, reason=${cancelReason}`,
      );
      const { cancelCaptcha } = await import("../utils/captcha.ts");
      const success = cancelCaptcha(
        captchaRequestId,
        cancelReason,
      );
      if (success) {
        logInfo(`验证码请求已取消: ${captchaRequestId}`);
      } else {
        logWarn(`验证码请求取消失败: ${captchaRequestId}`);
      }

      return c.json({ success });
    } catch (error) {
      logError("取消验证码失败:", error);
      return c.json({ error: "取消验证码失败" }, 500);
    }
  });

  app.get("/api/captcha/image", async (c) => {
    try {
      const requestId = c.req.query("requestId");
      if (
        typeof requestId !== "string" ||
        !validateRequiredString(requestId, "requestId")
      ) {
        logWarn("获取验证码图片失败: 缺少 requestId");
        return c.json({ error: "缺少 requestId 参数" }, 400);
      }
      const captchaRequestId = optionalTrimmedString(requestId) as string;

      const { getCaptchaImageUrl } = await import("../utils/captcha.ts");
      const imageUrl = getCaptchaImageUrl(captchaRequestId);
      if (!imageUrl) {
        logWarn(`获取验证码图片失败: 无效的 requestId: ${captchaRequestId}`);
        return c.json({ error: "无效的验证码请求" }, 404);
      }

      logDebug(`代理验证码图片: ${captchaRequestId} -> ${imageUrl}`);
      const response = await fetch2(imageUrl, {
        headers: {
          "Accept": "image/*,*/*",
          "Referer": imageUrl,
        },
      });

      if (!response.ok) {
        logError(
          `获取验证码图片失败: ${response.status} ${response.statusText}`,
        );
        return c.json({ error: "获取验证码图片失败" }, 502);
      }

      const imageBuffer = new Uint8Array(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") || "image/png";
      const imageError = imagePayloadError(imageBuffer, contentType);
      if (imageError) {
        logWarn(
          `验证码图片响应无效: requestId=${captchaRequestId}, content-type=${contentType}, ${imageError}`,
        );
        return c.json({ error: imageError }, 502);
      }
      c.header("Content-Type", contentType);
      c.header("Cache-Control", "no-cache, no-store, must-revalidate");
      return c.body(imageBuffer);
    } catch (error) {
      logError("获取验证码图片失败:", error);
      return c.json({ error: "获取验证码图片失败" }, 500);
    }
  });

  app.post("/api/downloads", async (c) => {
    try {
      const body = await readJsonObject(c);
      if (!body) return c.json({ error: "无效的请求体" }, 400);
      const { url, title, outputPath, quality, referer, format, proxy } = body;
      const missingFields = validateRequiredFields(body, ["url", "title"]);
      if (missingFields.length > 0) {
        logWarn(`创建下载任务失败: 缺少必需参数: ${missingFields.join(", ")}`);
        return c.json(
          { error: `缺少必需参数: ${missingFields.join(", ")}` },
          400,
        );
      }

      if (!validateUrl(url)) {
        logWarn("创建下载任务失败: 无效的URL参数");
        return c.json({ error: "无效的URL参数" }, 400);
      }

      logDebug(`创建下载任务: ${title}, url: ${url}, quality: ${quality}`);
      const taskId = downloadManager.createDownloadTask(
        (url as string).trim(),
        title as string,
        optionalTrimmedString(outputPath),
        optionalTrimmedString(referer),
        {
          format: normalizeDownloadFormatInput(format),
          proxy: normalizeUrlProxyInput(proxy),
        },
      );
      const task = downloadManager.getDownloadTask(taskId);
      await downloadManager.saveToKV();
      logInfo(`成功创建下载任务: ${taskId}`);
      return c.json({ task });
    } catch (error) {
      logError("创建下载任务失败:", error);
      if (
        error instanceof Error &&
        error.message.startsWith("下载URL不是直连媒体地址")
      ) {
        return c.json({ error: error.message }, 400);
      }
      return c.json({ error: "创建下载任务失败" }, 500);
    }
  });

  app.post("/api/downloads/:id/start", async (c) => {
    try {
      const taskId = c.req.param("id");
      if (!validateRequiredString(taskId, "taskId")) {
        logWarn("开始下载失败: 缺少或无效的任务ID");
        return c.json({ error: "缺少或无效的任务ID" }, 400);
      }
      const normalizedTaskId = optionalTrimmedString(taskId) as string;

      logDebug(`开始下载任务: ${normalizedTaskId}`);
      const task = downloadManager.getDownloadTask(normalizedTaskId);
      if (!task) {
        return c.json({ error: "下载任务不存在" }, 404);
      }

      if (task.status === "downloading") {
        return c.json({ success: true, message: "任务已在下载中" });
      }

      if (task.status === "completed") {
        return c.json({ success: true, message: "任务已下载完成" });
      }

      downloadManager.startDownload(normalizedTaskId);
      await downloadManager.saveToKV();
      logInfo(`下载任务 ${normalizedTaskId} 已加入队列`);
      return c.json({
        success: true,
        message: "任务已加入下载队列",
        task: downloadManager.getDownloadTask(normalizedTaskId),
      });
    } catch (error) {
      logError("开始下载失败:", error);
      return c.json({ error: "开始下载失败" }, 500);
    }
  });

  app.get("/api/downloads", (c) => {
    logDebug("获取所有下载任务");
    return c.json({ tasks: downloadManager.getAllDownloadTasks() });
  });

  app.get("/api/downloads/stats", (c) => {
    return c.json({
      stats: downloadManager.getStats(),
      active: downloadManager.getActiveDownloads().length,
      pending: downloadManager.getPendingDownloads().length,
      queue: downloadManager.getAllDownloadTasks().length,
    });
  });

  app.get("/api/downloads/:id", (c) => {
    try {
      const taskId = c.req.param("id");
      if (!validateRequiredString(taskId, "taskId")) {
        logWarn("获取下载任务状态失败: 缺少或无效的任务ID");
        return c.json({ error: "缺少或无效的任务ID" }, 400);
      }
      const normalizedTaskId = optionalTrimmedString(taskId) as string;

      logDebug(`获取下载任务状态: ${normalizedTaskId}`);
      const task = downloadManager.getDownloadTask(normalizedTaskId);
      if (!task) {
        logWarn(`下载任务不存在: ${normalizedTaskId}`);
        return c.json({ error: "下载任务不存在" }, 404);
      }

      return c.json({ task });
    } catch (error) {
      logError("获取下载任务状态失败:", error);
      return c.json({ error: "获取下载任务状态失败" }, 500);
    }
  });

  app.post("/api/downloads/:id/cancel", async (c) => {
    try {
      const taskId = c.req.param("id");
      if (!validateRequiredString(taskId, "taskId")) {
        logWarn("取消下载失败: 缺少或无效的任务ID");
        return c.json({ error: "缺少或无效的任务ID" }, 400);
      }
      const normalizedTaskId = optionalTrimmedString(taskId) as string;

      logDebug(`取消下载任务: ${normalizedTaskId}`);
      const task = downloadManager.getDownloadTask(normalizedTaskId);
      if (!task) {
        return c.json({ error: "下载任务不存在" }, 404);
      }

      const success = downloadManager.cancelDownload(normalizedTaskId);
      if (success) {
        logInfo(`下载任务 ${normalizedTaskId} 已取消`);
        await downloadManager.saveToKV();
      } else {
        logWarn(`取消下载任务 ${normalizedTaskId} 失败`);
      }
      return c.json({ success });
    } catch (error) {
      logError("取消下载失败:", error);
      return c.json({ error: "取消下载失败" }, 500);
    }
  });

  app.post("/api/downloads/:id/retry", async (c) => {
    try {
      const taskId = c.req.param("id");
      if (!validateRequiredString(taskId, "taskId")) {
        return c.json({ error: "缺少或无效的任务ID" }, 400);
      }
      const normalizedTaskId = optionalTrimmedString(taskId) as string;

      logDebug(`重试下载任务: ${normalizedTaskId}`);
      const task = downloadManager.getDownloadTask(normalizedTaskId);
      if (!task) {
        return c.json({ error: "下载任务不存在" }, 404);
      }

      const success = await downloadManager.retryDownload(normalizedTaskId);
      if (success) {
        await downloadManager.saveToKV();
      }
      return c.json({
        success,
        task: downloadManager.getDownloadTask(normalizedTaskId),
      });
    } catch (error) {
      logError("重试下载失败:", error);
      return c.json({ error: "重试下载失败" }, 500);
    }
  });

  app.delete("/api/downloads/:id", async (c) => {
    try {
      const taskId = c.req.param("id");
      const deleteFile = c.req.query("deleteFile") === "true";

      if (!validateRequiredString(taskId, "taskId")) {
        return c.json({ error: "缺少或无效的任务ID" }, 400);
      }
      const normalizedTaskId = optionalTrimmedString(taskId) as string;

      logDebug(`删除下载任务: ${normalizedTaskId}, 删除文件: ${deleteFile}`);
      const task = downloadManager.getDownloadTask(normalizedTaskId);
      if (!task) {
        return c.json({ error: "下载任务不存在" }, 404);
      }

      const success = downloadManager.deleteDownload(
        normalizedTaskId,
        deleteFile,
      );
      if (success) {
        await downloadManager.saveToKV();
      }
      return c.json({ success });
    } catch (error) {
      logError("删除下载任务失败:", error);
      return c.json({ error: "删除下载任务失败" }, 500);
    }
  });

  app.post("/api/downloads/clear-completed", async (c) => {
    try {
      const body = await readJsonObject(c) ?? {};
      const deleteFiles = body.deleteFiles === true;

      logDebug(`清除已完成下载任务, 删除文件: ${deleteFiles}`);
      const result = downloadManager.clearCompletedDownloads(deleteFiles);
      if (result.count > 0) {
        logInfo(
          `已清除 ${result.count} 个已完成下载任务，删除 ${result.deletedFiles} 个文件`,
        );
        await downloadManager.saveToKV();
      } else {
        logInfo("没有可清除的已完成下载任务");
      }

      return c.json({
        success: true,
        clearedCount: result.count,
        deletedFiles: result.deletedFiles,
      });
    } catch (error) {
      logError("清除已完成下载失败:", error);
      return c.json({ error: "清除已完成下载失败" }, 500);
    }
  });

  app.get("/api/health", (c) => {
    const sourcesHealth = videoSourceManager.getHealthStatus();
    const healthySources = Object.values(sourcesHealth).filter((h) =>
      h.status === "healthy"
    ).length;
    const totalSources = Object.keys(sourcesHealth).length;

    return c.json({
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
    });
  });

  app.get("/ws", (c) => {
    const upgrade = c.req.header("upgrade");
    if (upgrade?.toLowerCase() !== "websocket") {
      return c.text("Expected websocket", 400);
    }

    const { socket, response } = Deno.upgradeWebSocket(c.req.raw);
    rpcServer.handleConnection(socket);
    return response;
  });
}
