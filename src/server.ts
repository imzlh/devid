import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import { VideoSourceManager } from "./manager.ts";
import { DownloadManager } from "./utils/download.ts";
import { M3U8Parser, M3U8Service } from "./utils/m3u8.ts";
import { enableVerboseLogs, logInfo, logError, logDebug, logWarn } from "./utils/logger.ts";
import { fetch2 } from "./utils/fetch.ts";
import {
    validateRequiredString,
    validateUrl,
    validateRequiredFields,
    validatePagination
} from "./utils/validation.ts";
import { getConfig, createDefaultConfig } from "./config/index.ts";
import { rpcServer } from "./websocket/rpc.ts";
import { pushDownloadUpdate, pushSourceChange } from "./websocket/push.ts";

// 初始化配置（自动创建默认配置文件）
await createDefaultConfig();
const config = getConfig();

// 创建视频源管理器和下载管理器
const videoSourceManager = new VideoSourceManager();
const downloadManager = new DownloadManager();

// 检查是否启用verbose日志
if (config.server.verboseLogging) {
    enableVerboseLogs();
    logInfo("Verbose logging enabled");
}

// 创建 Hono 应用
const app = new Hono();

// CORS 中间件
app.use("*", async (c, next) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Range");
    c.header("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
    await next();
});

// 日志中间件
app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    logDebug(`${c.req.method} ${c.req.url} - ${c.res.status} - ${ms}ms`);
});

// API超时中间件 - 30秒超时
app.use("/api/*", async (c, next) => {
    const API_TIMEOUT = 30000;
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('API请求超时')), API_TIMEOUT);
    });

    try {
        await Promise.race([next(), timeoutPromise]);
    } catch (error) {
        if (error instanceof Error && error.message === 'API请求超时') {
            logWarn(`API请求超时: ${c.req.method} ${c.req.url}`);
            return c.json({ error: '请求超时，请稍后重试' }, 504);
        }
        throw error;
    }
});

// 静态文件服务 - /static/* 路径
app.use("/static/*", serveStatic({ root: "./public" }));

// ==================== HTTP API 路由 ====================

// 获取所有视频源
app.get("/api/sources", (c) => {
    logDebug("获取所有视频源");
    return c.json(videoSourceManager.getAllSources());
});

// 获取视频源健康状态
app.get("/api/sources/health", (c) => {
    logDebug("获取视频源健康状态");
    return c.json({
        health: videoSourceManager.getHealthStatus(),
        initialized: videoSourceManager.isInitialized(),
        activeSourceId: videoSourceManager.getActiveSourceId()
    });
});

// 重新初始化指定视频源
app.post("/api/sources/:id/reinit", async (c) => {
    try {
        const sourceId = c.req.param("id");

        if (!validateRequiredString(sourceId, "sourceId")) {
            return c.json({ error: "缺少或无效的视频源ID" }, 400);
        }

        logInfo(`重新初始化视频源: ${sourceId}`);
        const success = await videoSourceManager.initSource(sourceId);

        return c.json({
            success,
            health: videoSourceManager.getHealthStatus()[sourceId]
        });
    } catch (error) {
        logError("重新初始化视频源失败:", error);
        return c.json({ error: "重新初始化失败" }, 500);
    }
});

// 设置活动视频源
app.post("/api/sources/active", async (c) => {
    try {
        const body = await c.req.json();
        const { id: sourceId } = body;

        if (!validateRequiredString(sourceId, "source")) {
            logWarn("设置活动视频源失败: 缺少或无效的source参数");
            return c.json({ error: "缺少或无效的source参数" }, 400);
        }

        logDebug(`设置活动视频源: ${sourceId}`);

        const success = videoSourceManager.setActiveSource(sourceId);
        if (success) {
            logInfo(`成功设置活动视频源: ${sourceId}`);
            const newSource = videoSourceManager.getActiveSource();
            if (newSource) {
                pushSourceChange(newSource.getId(), newSource.getName());
            }
        } else {
            logWarn(`设置活动视频源失败: ${sourceId}`);
        }
        return c.json({ success });
    } catch (error) {
        logError("设置活动视频源请求处理失败:", error);
        return c.json({ error: "请求处理失败" }, 500);
    }
});

// 获取当前活动视频源
app.get("/api/sources/active", (c) => {
    logDebug("获取当前活动视频源");
    const activeSource = videoSourceManager.getActiveSource();
    const sourceId = videoSourceManager.getActiveSourceId();
    return c.json({
        id: sourceId,
        name: activeSource?.getName() || null
    });
});

// 获取主页视频
app.get("/api/home-videos", async (c) => {
    try {
        const activeSource = videoSourceManager.getActiveSource();
        const pageParam = c.req.query("page") || "1";

        if (!validatePagination(pageParam)) {
            logWarn("获取主页视频失败: 无效的分页参数");
            return c.json({ error: "无效的分页参数" }, 400);
        }

        const page = parseInt(pageParam);
        logDebug(`获取主页视频, page: ${page}`);

        if (!activeSource) {
            logWarn("没有活动的视频源");
            return c.json({ error: "没有活动的视频源" }, 400);
        }

        const result = await activeSource.getHomeVideos(page);
        logInfo(`获取到 ${result.videos.length} 个主页视频, 当前页: ${result.currentPage}, 总页数: ${result.totalPages}`);
        return c.json(result);
    } catch (error) {
        logError("获取主页视频失败:", error);
        return c.json({ error: "获取主页视频失败" }, 500);
    }
});

// 搜索视频
app.get("/api/search", async (c) => {
    try {
        const activeSource = videoSourceManager.getActiveSource();
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

        const page = parseInt(pageParam);
        logDebug(`搜索视频: ${query}, page: ${page}`);

        if (!activeSource) {
            logWarn("没有活动的视频源");
            return c.json({ error: "没有活动的视频源" }, 400);
        }

        const results = await activeSource.searchVideos(query, page);
        logInfo(`搜索到 ${results.videos.length} 个视频`);
        return c.json(results);
    } catch (error) {
        logError("搜索视频失败:", error);
        return c.json({ error: "搜索视频失败" }, 500);
    }
});

// ==================== 系列 API ====================

// 获取系列详情（基本信息，不包含完整剧集列表）
app.get("/api/series/:id", async (c) => {
    try {
        const seriesId = c.req.param("id");
        const url = c.req.query("url");

        if (!seriesId && !url) {
            return c.json({ error: "缺少系列ID或URL" }, 400);
        }

        logDebug(`获取系列详情: ${seriesId}`);

        const detail = await videoSourceManager.getSeries(seriesId, url || undefined);
        if (!detail) {
            return c.json({ error: "系列不存在" }, 404);
        }

        return c.json(detail);
    } catch (error) {
        logError("获取系列详情失败:", error);
        return c.json({ error: "获取系列详情失败" }, 500);
    }
});

// 获取无限系列视频列表（用于无限播放模式）
app.get("/api/series/:id/videos", async (c) => {
    try {
        const seriesId = c.req.param("id");

        if (!seriesId) {
            return c.json({ error: "缺少系列ID" }, 400);
        }

        logDebug(`获取无限系列视频: ${seriesId}`);

        const result = await videoSourceManager.getSeriesVideos(seriesId);
        if (!result) {
            return c.json({ error: "系列不存在" }, 404);
        }

        return c.json(result);
    } catch (error) {
        logError("获取无限系列视频失败:", error);
        return c.json({ error: "获取无限系列视频失败" }, 500);
    }
});

// 解析视频链接
app.post("/api/parse-video", async (c) => {
    try {
        const activeSource = videoSourceManager.getActiveSource();
        const body = await c.req.json();
        const { url } = body;

        if (!validateUrl(url)) {
            logWarn("解析视频链接失败: 缺少或无效的URL参数");
            return c.json({ error: "缺少或无效的URL参数" }, 400);
        }

        logDebug(`解析视频链接: ${url}`);

        if (!activeSource) {
            logWarn("没有活动的视频源");
            return c.json({ error: "没有活动的视频源" }, 400);
        }

        const m3u8Results = await activeSource.parseVideoUrl(url);
        logInfo(`解析视频链接成功，获取到 ${m3u8Results.length} 个结果`);
        return c.json({ results: m3u8Results });
    } catch (error) {
        logError("解析视频链接失败:", error);
        return c.json({ error: "解析视频链接失败" }, 500);
    }
});

// 解析M3U8
app.get("/api/parse-m3u8", async (c) => {
    try {
        const url = c.req.query("url");

        if (!url || !validateUrl(url)) {
            logWarn("解析M3U8失败: 缺少或无效的URL参数");
            return c.json({ error: "缺少或无效的URL参数" }, 400);
        }

        logDebug(`解析M3U8: ${url}`);

        const results = await M3U8Service.fetchAndParseM3U8(url);
        logInfo(`成功解析M3U8，获取到 ${results.length} 个结果`);
        return c.json({ results });
    } catch (error) {
        logError("解析M3U8失败:", error);
        return c.json({ error: "解析M3U8失败" }, 500);
    }
});

interface ProxyResponse {
    data: Uint8Array | ReadableStream<Uint8Array>;
    contentType: string;
    status: number;
    headers: Record<string, string>;
}

async function handleProxyRequest(
    encodedUrl: string,
    referer?: string,
    task_id?: string,
    range?: string,
    body_type?: string,
    proxy?: string
): Promise<ProxyResponse> {
    try {
        const originalUrl = decodeURIComponent(encodedUrl);

        const requestHeaders: Record<string, string> = {
            "Referer": referer || "",
            "Origin": referer ? new URL(referer).origin : "",
        };

        if (range) {
            requestHeaders["Range"] = range;
        }

        const response = await fetch2(originalUrl, {
            headers: requestHeaders,
            timeout: 300000,
            useProxy: proxy == 'remote'
        });

        if (!response.ok && response.status !== 206) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get("content-type") || "application/octet-stream";
        const responseHeaders: Record<string, string> = {};

        const contentRange = response.headers.get("content-range");
        if (contentRange) {
            responseHeaders["Content-Range"] = contentRange;
        }

        const contentLength = response.headers.get("content-length");
        if (contentLength) {
            responseHeaders["Content-Length"] = contentLength;
        }

        if (contentType.startsWith("video/") || contentType.startsWith("audio/")) {
            responseHeaders["Accept-Ranges"] = "bytes";
        }

        if (originalUrl.includes(".m3u8") || contentType.includes("application/vnd.apple.mpegurl") || body_type == "m3u8") {
            const parser = new M3U8Parser(originalUrl);
            const text = await response.text();
            const manifest = M3U8Parser.identifyPlaylistType(text) === "master"
                ? parser.parseMasterPlaylist(text)
                : parser.parseMediaPlaylist(text);

            const rewritten = M3U8Service.serializeManifest(manifest, {
                taskId: task_id,
                referer,
                proxy
            });

            if (task_id) {
                downloadManager.markStart(task_id, manifest.segments.length);
            }

            return {
                data: new TextEncoder().encode(rewritten),
                contentType: "application/vnd.apple.mpegurl",
                status: 200,
                headers: {},
            };
        }

        if (body_type == "ts" && (parseInt(contentLength ?? '0') < 2 * 1024 || task_id)) {
            const data = new Uint8Array(await response.arrayBuffer());
            const fixed = M3U8Service.fixTSStream(data);

            if (task_id) {
                downloadManager.markStep(task_id);
            }

            return {
                data: fixed,
                contentType: "video/mp2t",
                status: response.status,
                headers: (() => {
                    const { "Content-Length": _, ...rest } = responseHeaders;
                    return rest;
                })(),
            };
        }

        if (!response.body)
            throw new Error("The response from upstream has no body");
        let targetStream = response.body;
        const contentLen = parseInt(response.headers.get("content-length") || "0");
        if (task_id && contentLen) {
            let written = 0;
            const transform = new TransformStream<Uint8Array>({
                transform(chunk, ctrl) {
                    ctrl.enqueue(chunk);
                    written += chunk.byteLength;
                    downloadManager.setProgress(task_id, written / contentLen);
                }
            });
            response.body.pipeTo(transform.writable);
            targetStream = transform.readable;
        }

        return {
            contentType,
            status: response.status,
            headers: responseHeaders,
            data: targetStream
        };
    } catch (error) {
        logError(`Proxy request failed: ${encodedUrl}`, error);
        throw error;
    }
}

// M3U8/视频代理 - OPTIONS 预检请求处理
app.options("/api/proxy/:name", (c) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    c.header("Access-Control-Allow-Headers", "Range, Content-Type, Authorization");
    c.header("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
    c.header("Access-Control-Max-Age", "86400");
    return c.body(null, 204);
});

app.get("/api/proxy/:name", async (c) => {
    try {
        const encodedUrl = c.req.query("url");

        if (!validateRequiredString(encodedUrl, "url")) {
            logWarn("代理请求失败: 缺少URL参数");
            return c.json({ error: "缺少URL参数" }, 400);
        }

        const rangeHeader = c.req.header("range");
        logDebug(`处理代理请求: ${encodedUrl}, Range: ${rangeHeader || "none"}`);

        const trace_id = c.req.query("taskId");
        const referer = c.req.query("referer");

        const { data, contentType, status, headers } = await handleProxyRequest(
            encodedUrl!,
            referer ?? undefined,
            trace_id ?? undefined,
            rangeHeader ?? undefined,
            c.req.query("type") ?? undefined,
            c.req.query("proxy") ?? undefined
        );

        logDebug(`代理请求成功，内容类型: ${contentType}, 状态: ${status}`);

        c.header("Access-Control-Allow-Origin", "*");
        c.header("Access-Control-Allow-Headers", "Range, Content-Type");
        c.header("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
        c.header("Cache-Control", "max-age=3600");

        for (const [key, value] of Object.entries(headers)) {
            c.header(key, value);
        }

        if (contentType.startsWith("video/") || contentType.startsWith("audio/")) {
            c.header("Accept-Ranges", "bytes");
        }

        if (c.req.param("name") && (contentType.includes("mpegurl") || encodedUrl!.includes(".m3u8"))) {
            c.header("Content-Disposition", `attachment; filename="${c.req.param("name")}.m3u8"`);
        }

        c.status(status as 200 | 206);
        return c.body(data as Uint8Array<ArrayBuffer>);
    } catch (error) {
        logError("处理代理请求失败:", error);
        return c.json({ error: "处理代理请求失败" }, 500);
    }
});

// 图片代理
app.get("/api/image-proxy", async (c) => {
    try {
        const imageUrl = c.req.query("url");
        const sourceId = c.req.query("source");

        if (!imageUrl || !validateUrl(imageUrl)) {
            logWarn("图片代理失败: 缺少或无效的图片URL");
            return c.json({ error: "缺少或无效的图片URL" }, 400);
        }

        logDebug(`图片代理请求: ${imageUrl}, sourceId: ${sourceId}`);

        if (sourceId) {
            const source = videoSourceManager.getSource(sourceId);
            if (source) {
                logDebug(`使用源 ${sourceId} 获取图片`);
                const imageData = await source.getImage(imageUrl);
                c.header("Content-Type", imageData.contentType);
                return c.body(imageData.data as Uint8Array<ArrayBuffer>);
            }
        }

        logDebug("使用默认方式获取图片");
        const proxiedImage = await fetch2(imageUrl);
        const imageBuffer = new Uint8Array(await proxiedImage.arrayBuffer());
        c.header("Content-Type", proxiedImage.headers.get("content-type") || "image/jpeg");
        c.header("Access-Control-Allow-Origin", "*");
        c.header("Cache-Control", "max-age=3600");
        return c.body(imageBuffer);
    } catch (error) {
        logError("图片代理失败:", error);
        return c.json({ error: error instanceof Error ? error.message : error }, 500);
    }
});

// ==================== 验证码 API ====================

// 提交验证码答案
app.post("/api/captcha/submit", async (c) => {
    try {
        const body = await c.req.json();
        const { requestId, answer } = body;

        if (!validateRequiredString(requestId, "requestId")) {
            logWarn("提交验证码失败: 缺少或无效的requestId");
            return c.json({ error: "缺少或无效的requestId" }, 400);
        }

        if (!validateRequiredString(answer, "answer")) {
            logWarn("提交验证码失败: 缺少或无效的answer");
            return c.json({ error: "缺少或无效的answer" }, 400);
        }

        logDebug(`提交验证码答案: requestId=${requestId}, answer=${answer}`);

        const { resolveCaptcha } = await import("./utils/captcha.ts");
        const success = resolveCaptcha(requestId, answer);

        if (success) {
            logInfo(`验证码答案已提交: ${requestId}`);
        } else {
            logWarn(`验证码答案提交失败: ${requestId}`);
        }

        return c.json({ success });
    } catch (error) {
        logError("提交验证码失败:", error);
        return c.json({ error: "提交验证码失败" }, 500);
    }
});

// 取消验证码请求
app.post("/api/captcha/cancel", async (c) => {
    try {
        const body = await c.req.json();
        const { requestId, reason } = body;

        if (!validateRequiredString(requestId, "requestId")) {
            logWarn("取消验证码失败: 缺少或无效的requestId");
            return c.json({ error: "缺少或无效的requestId" }, 400);
        }

        logDebug(`取消验证码请求: requestId=${requestId}, reason=${reason || "用户取消"}`);

        const { cancelCaptcha } = await import("./utils/captcha.ts");
        const success = cancelCaptcha(requestId, reason || "用户取消");

        if (success) {
            logInfo(`验证码请求已取消: ${requestId}`);
        } else {
            logWarn(`验证码请求取消失败: ${requestId}`);
        }

        return c.json({ success });
    } catch (error) {
        logError("取消验证码失败:", error);
        return c.json({ error: "取消验证码失败" }, 500);
    }
});

// ==================== 下载 API ====================

// 创建下载任务
app.post("/api/downloads", async (c) => {
    try {
        const body = await c.req.json();
        const { url, title, outputPath, quality, referer } = body;

        const missingFields = validateRequiredFields(body, ["url", "title"]);
        if (missingFields.length > 0) {
            logWarn(`创建下载任务失败: 缺少必需参数: ${missingFields.join(", ")}`);
            return c.json({ error: `缺少必需参数: ${missingFields.join(", ")}` }, 400);
        }

        if (!validateUrl(url)) {
            logWarn("创建下载任务失败: 无效的URL参数");
            return c.json({ error: "无效的URL参数" }, 400);
        }

        logDebug(`创建下载任务: ${title}, url: ${url}, quality: ${quality}`);

        const taskId = downloadManager.createDownloadTask(url, title, outputPath, referer);
        const task = downloadManager.getDownloadTask(taskId);
        logInfo(`成功创建下载任务: ${taskId}`);
        return c.json({ task });
    } catch (error) {
        logError("创建下载任务失败:", error);
        return c.json({ error: "创建下载任务失败" }, 500);
    }
});

// 开始下载
app.post("/api/downloads/:id/start", async (c) => {
    try {
        const taskId = c.req.param("id");

        if (!validateRequiredString(taskId, "taskId")) {
            logWarn("开始下载失败: 缺少或无效的任务ID");
            return c.json({ error: "缺少或无效的任务ID" }, 400);
        }

        logDebug(`开始下载任务: ${taskId}`);

        const task = downloadManager.getDownloadTask(taskId);
        if (!task) {
            return c.json({ error: "下载任务不存在" }, 404);
        }

        if (task.status === "downloading") {
            return c.json({ success: true, message: "任务已在下载中" });
        }

        if (task.status === "completed") {
            return c.json({ success: true, message: "任务已下载完成" });
        }

        const success = downloadManager.startDownload(taskId);

        logInfo(`下载任务 ${taskId} 已加入队列`);
        return c.json({
            success: true,
            message: "任务已加入下载队列",
            task: downloadManager.getDownloadTask(taskId)
        });
    } catch (error) {
        logError("开始下载失败:", error);
        return c.json({ error: "开始下载失败" }, 500);
    }
});

// 获取下载任务状态
app.get("/api/downloads/:id", (c) => {
    try {
        const taskId = c.req.param("id");

        if (!validateRequiredString(taskId, "taskId")) {
            logWarn("获取下载任务状态失败: 缺少或无效的任务ID");
            return c.json({ error: "缺少或无效的任务ID" }, 400);
        }

        logDebug(`获取下载任务状态: ${taskId}`);
        const task = downloadManager.getDownloadTask(taskId);

        if (!task) {
            logWarn(`下载任务不存在: ${taskId}`);
            return c.json({ error: "下载任务不存在" }, 404);
        }

        return c.json({ task });
    } catch (error) {
        logError("获取下载任务状态失败:", error);
        return c.json({ error: "获取下载任务状态失败" }, 500);
    }
});

// 获取所有下载任务
app.get("/api/downloads", (c) => {
    logDebug("获取所有下载任务");
    const tasks = downloadManager.getAllDownloadTasks();
    return c.json({ tasks });
});

// 取消下载
app.post("/api/downloads/:id/cancel", async (c) => {
    try {
        const taskId = c.req.param("id");

        if (!validateRequiredString(taskId, "taskId")) {
            logWarn("取消下载失败: 缺少或无效的任务ID");
            return c.json({ error: "缺少或无效的任务ID" }, 400);
        }

        logDebug(`取消下载任务: ${taskId}`);

        const success = downloadManager.cancelDownload(taskId);
        if (success) {
            logInfo(`下载任务 ${taskId} 已取消`);
            await downloadManager.saveToKV();
        } else {
            logWarn(`取消下载任务 ${taskId} 失败`);
        }
        return c.json({ success });
    } catch (error) {
        logError("取消下载失败:", error);
        return c.json({ error: "取消下载失败" }, 500);
    }
});

// 重试下载
app.post("/api/downloads/:id/retry", async (c) => {
    try {
        const taskId = c.req.param("id");

        if (!validateRequiredString(taskId, "taskId")) {
            return c.json({ error: "缺少或无效的任务ID" }, 400);
        }

        logDebug(`重试下载任务: ${taskId}`);

        const task = downloadManager.getDownloadTask(taskId);
        if (!task) {
            return c.json({ error: "下载任务不存在" }, 404);
        }

        const success = await downloadManager.retryDownload(taskId);
        return c.json({ success, task: downloadManager.getDownloadTask(taskId) });
    } catch (error) {
        logError("重试下载失败:", error);
        return c.json({ error: "重试下载失败" }, 500);
    }
});

// 删除下载任务
app.delete("/api/downloads/:id", async (c) => {
    try {
        const taskId = c.req.param("id");
        const deleteFile = c.req.query("deleteFile") === "true";

        if (!validateRequiredString(taskId, "taskId")) {
            return c.json({ error: "缺少或无效的任务ID" }, 400);
        }

        logDebug(`删除下载任务: ${taskId}, 删除文件: ${deleteFile}`);

        const success = downloadManager.deleteDownload(taskId, deleteFile);
        if (success) {
            await downloadManager.saveToKV();
        }
        return c.json({ success });
    } catch (error) {
        logError("删除下载任务失败:", error);
        return c.json({ error: "删除下载任务失败" }, 500);
    }
});

// 获取下载统计
app.get("/api/downloads/stats", (c) => {
    return c.json({
        stats: downloadManager.getStats(),
        active: downloadManager.getActiveDownloads().length,
        pending: downloadManager.getPendingDownloads().length,
        queue: downloadManager.getAllDownloadTasks().length
    });
});

// 清除已完成下载
app.post("/api/downloads/clear-completed", async (c) => {
    try {
        const body = await c.req.json().catch(() => ({}));
        const deleteFiles = body.deleteFiles === true;

        logDebug(`清除已完成下载任务, 删除文件: ${deleteFiles}`);

        const result = downloadManager.clearCompletedDownloads(deleteFiles);

        if (result.count > 0) {
            logInfo(`已清除 ${result.count} 个已完成下载任务，删除 ${result.deletedFiles} 个文件`);
            await downloadManager.saveToKV();
        } else {
            logInfo("没有可清除的已完成下载任务");
        }

        return c.json({
            success: result.count > 0,
            clearedCount: result.count,
            deletedFiles: result.deletedFiles
        });
    } catch (error) {
        logError("清除已完成下载失败:", error);
        return c.json({ error: "清除已完成下载失败" }, 500);
    }
});

// 健康检查端点
app.get("/api/health", (c) => {
    const sourcesHealth = videoSourceManager.getHealthStatus();
    const healthySources = Object.values(sourcesHealth).filter(h => h.status === "healthy").length;
    const totalSources = Object.keys(sourcesHealth).length;

    return c.json({
        status: healthySources > 0 ? "ok" : "degraded",
        timestamp: new Date().toISOString(),
        uptime: performance.now(),
        sources: {
            total: totalSources,
            healthy: healthySources,
            initialized: videoSourceManager.isInitialized()
        },
        downloads: {
            active: downloadManager.getActiveDownloads().length,
            pending: downloadManager.getPendingDownloads().length,
            total: downloadManager.getAllDownloadTasks().length
        },
        wsClients: rpcServer.getClientCount()
    });
});

// ==================== WebSocket 升级处理 ====================

app.get("/ws", (c) => {
    const upgrade = c.req.header("upgrade");
    if (upgrade !== "websocket") {
        return c.text("Expected websocket", 400);
    }

    const { socket, response } = Deno.upgradeWebSocket(c.req.raw);
    rpcServer.handleConnection(socket);

    return response;
});

// ==================== 注册 RPC 方法 ====================

rpcServer.register("sources.getAll", () => videoSourceManager.getAllSources());

rpcServer.register("sources.getHealth", () => ({
    health: videoSourceManager.getHealthStatus(),
    initialized: videoSourceManager.isInitialized(),
    activeSourceId: videoSourceManager.getActiveSourceId()
}));

rpcServer.register("sources.reinit", async (...params: unknown[]) => {
    const sourceId = params[0] as string;
    const success = await videoSourceManager.initSource(sourceId);
    return {
        success,
        health: videoSourceManager.getHealthStatus()[sourceId]
    };
});

rpcServer.register("sources.getActive", () => {
    const activeSource = videoSourceManager.getActiveSource();
    const sourceId = videoSourceManager.getActiveSourceId();
    return {
        id: sourceId,
        name: activeSource?.getName() || null
    };
});

rpcServer.register("sources.setActive", async (...params: unknown[]) => {
    const sourceId = params[0] as string;
    const success = videoSourceManager.setActiveSource(sourceId);
    if (success) {
        const newSource = videoSourceManager.getActiveSource();
        if (newSource) {
            pushSourceChange(newSource.getId(), newSource.getName());
        }
    }
    return { success };
});

rpcServer.register("videos.getHome", async (...params: unknown[]) => {
    const page = (params[0] as number) || 1;
    const activeSource = videoSourceManager.getActiveSource();
    if (!activeSource) throw new Error("没有活动的视频源");
    return activeSource.getHomeVideos(page);
});

rpcServer.register("videos.search", async (...params: unknown[]) => {
    const query = params[0] as string;
    const page = (params[1] as number) || 1;
    const activeSource = videoSourceManager.getActiveSource();
    if (!activeSource) throw new Error("没有活动的视频源");
    return activeSource.searchVideos(query, page);
});

rpcServer.register("series.getDetail", async (...params: unknown[]) => {
    const seriesId = params[0] as string;
    const url = params[1] as string | undefined;
    const detail = await videoSourceManager.getSeries(seriesId, url || undefined);
    if (!detail) throw new Error("系列不存在");
    return detail;
});

rpcServer.register("series.getVideos", async (...params: unknown[]) => {
    const seriesId = params[0] as string;
    const result = await videoSourceManager.getSeriesVideos(seriesId);
    if (!result) throw new Error("系列不存在");
    return result;
});

rpcServer.register("videos.parse", async (...params: unknown[]) => {
    const url = params[0] as string;
    const activeSource = videoSourceManager.getActiveSource();
    if (!activeSource) throw new Error("没有活动的视频源");
    const results = await activeSource.parseVideoUrl(url);
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
    const taskId = downloadManager.createDownloadTask(url, title, outputPath, referer);
    const task = downloadManager.getDownloadTask(taskId);
    return { task };
});

rpcServer.register("downloads.start", async (...params: unknown[]) => {
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
    return { success: true, message: "任务已加入下载队列", task: downloadManager.getDownloadTask(taskId) };
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
        queue: downloadManager.getAllDownloadTasks().length
    };
});

rpcServer.register("downloads.clearCompleted", async (...params: unknown[]) => {
    const deleteFiles = params[0] as boolean;
    const result = downloadManager.clearCompletedDownloads(deleteFiles);
    if (result.count > 0) {
        await downloadManager.saveToKV();
    }
    return {
        success: result.count > 0,
        clearedCount: result.count,
        deletedFiles: result.deletedFiles
    };
});

// ==================== 验证码 RPC 方法 ====================

rpcServer.register("captcha.submit", async (...params: unknown[]) => {
    const requestId = params[0] as string;
    const answer = params[1] as string;
    const { resolveCaptcha } = await import("./utils/captcha.ts");
    const success = resolveCaptcha(requestId, answer);
    return { success };
});

rpcServer.register("captcha.cancel", async (...params: unknown[]) => {
    const requestId = params[0] as string;
    const reason = (params[1] as string) || "用户取消";
    const { cancelCaptcha } = await import("./utils/captcha.ts");
    const success = cancelCaptcha(requestId, reason);
    return { success };
});

rpcServer.register("health.get", () => {
    const sourcesHealth = videoSourceManager.getHealthStatus();
    const healthySources = Object.values(sourcesHealth).filter(h => h.status === "healthy").length;
    const totalSources = Object.keys(sourcesHealth).length;

    return {
        status: healthySources > 0 ? "ok" : "degraded",
        timestamp: new Date().toISOString(),
        uptime: performance.now(),
        sources: {
            total: totalSources,
            healthy: healthySources,
            initialized: videoSourceManager.isInitialized()
        },
        downloads: {
            active: downloadManager.getActiveDownloads().length,
            pending: downloadManager.getPendingDownloads().length,
            total: downloadManager.getAllDownloadTasks().length
        },
        wsClients: rpcServer.getClientCount()
    };
});

// ==================== 静态文件服务（SPA 回退）====================

// 根路径返回index.html
app.get("/", serveStatic({ path: "./public/index.html" }));

// 静态文件服务 - 使用Hono的serveStatic
app.use("/*", serveStatic({ root: "./public" }));

// SPA回退：对于前端路由，返回index.html
app.use("*", async (c, next) => {
    const path = c.req.path;

    // API和WebSocket请求跳过
    if (path.startsWith("/api/") || path.startsWith("/ws")) {
        await next();
        return;
    }

    // 其他所有请求返回index.html
    try {
        const html = await Deno.readTextFile("./public/index.html");
        return c.html(html);
    } catch {
        return c.text("Not Found", 404);
    }
});

// ==================== 启动服务器 ====================

const port = config.server.port;

// 加载持久化的下载任务
try {
    await downloadManager.loadFromKV();
} catch (error) {
    logWarn("加载持久化下载任务失败:", error);
}

// 初始化视频源
logInfo("开始初始化视频源...");
try {
    await videoSourceManager.initAllSources();
    logInfo("视频源初始化完成");
} catch (error) {
    logError("视频源初始化失败:", error);
}

// 定期保存下载任务（每30秒）
setInterval(async () => {
    try {
        await downloadManager.saveToKV();
    } catch (error) {
        logError("保存下载任务失败:", error);
    }
}, 30000);

// 启动下载状态推送定时器
setInterval(() => {
    const tasks = downloadManager.getAllDownloadTasks();
    const activeTasks = tasks.filter((t: { status: string }) =>
        t.status === "downloading" || t.status === "pending"
    );
    if (activeTasks.length > 0) {
        pushDownloadUpdate(tasks);
    }
}, 2000);

// 优雅关闭处理
const gracefulShutdown = async () => {
    logInfo("正在关闭服务器...");

    videoSourceManager.stopHealthCheck();

    try {
        await downloadManager.saveToKV();
        logInfo("下载任务已保存");
    } catch (error) {
        logError("保存下载任务失败:", error);
    }

    downloadManager.stopCleanupTimer();

    logInfo("服务器已关闭");
    Deno.exit(0);
};

Deno.addSignalListener("SIGINT", gracefulShutdown);

logInfo(`服务器启动在 http://localhost:${port}`);
logInfo(`HTTP API: http://localhost:${port}/api`);
logInfo(`WebSocket: ws://localhost:${port}/ws`);

if (config.server.verboseLogging) {
    logInfo("Verbose logging is enabled. Set verboseLogging=false in config.json to disable.");
}

export const SERVER_ADDR = `http://localhost:${port}`;

Deno.serve({ port }, app.fetch);
