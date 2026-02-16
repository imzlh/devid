import { Application, Router, send } from 'oak';
import { VideoSourceManager } from './manager.ts';
import { DownloadManager } from './utils/download.ts';
import { M3U8Parser, M3U8Service } from './utils/m3u8.ts';
import { enableVerboseLogs, logInfo, logError, logDebug, logWarn } from './utils/logger.ts';
import { fetch2 } from "./utils/fetch.ts";
import {
    validateRequiredString,
    validateUrl,
    validateRequiredFields,
    validatePagination
} from "./utils/validation.ts";
import { getConfig, createDefaultConfig } from "./config/index.ts";

// 创建应用实例
const app = new Application();
const router = new Router();

// 初始化配置（自动创建默认配置文件）
await createDefaultConfig();
const config = getConfig();

// 创建视频源管理器和下载管理器
const videoSourceManager = new VideoSourceManager();
const downloadManager = new DownloadManager();

// 检查是否启用verbose日志
if (config.server.verboseLogging) {
    enableVerboseLogs();
    logInfo('Verbose logging enabled');
}

// 数据持久化使用 Deno KV，无需文件路径

// 中间件：设置CORS和错误处理
app.use(async (ctx, next) => {
    // 设置CORS头
    ctx.response.headers.set('Access-Control-Allow-Origin', '*');
    ctx.response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    ctx.response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    try {
        await next();
    } catch (error) {
        logError('服务器错误:', error);
        ctx.response.status = 500;
        ctx.response.body = { error: '服务器内部错误' };
    }
});

// 中间件：日志记录
app.use(async (ctx, next) => {
    const taskId = ctx.request.url.searchParams.get('taskId');
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    if (!taskId) {
        console.info(`${ctx.request.method} ${ctx.request.url} - ${ctx.response.status} - ${ms}ms`);
    }
});

// 静态文件服务
app.use(async (ctx, next) => {
    if (ctx.request.url.pathname.startsWith('/static/')) {
        await send(ctx, ctx.request.url.pathname.slice(1), {
            root: `${Deno.cwd()}/public`
        });
    } else {
        await next();
    }
});

// API路由

// 获取所有视频源
router.get('/api/sources', (ctx) => {
    logDebug('获取所有视频源');
    ctx.response.body = videoSourceManager.getAllSources();
});

// 获取视频源健康状态
router.get('/api/sources/health', (ctx) => {
    logDebug('获取视频源健康状态');
    ctx.response.body = {
        health: videoSourceManager.getHealthStatus(),
        initialized: videoSourceManager.isInitialized(),
        activeSourceId: videoSourceManager.getActiveSourceId()
    };
});

// 重新初始化指定视频源
router.post('/api/sources/:id/reinit', async (ctx) => {
    try {
        const sourceId = ctx.params.id;
        
        if (!validateRequiredString(sourceId, 'sourceId')) {
            ctx.response.status = 400;
            ctx.response.body = { error: '缺少或无效的视频源ID' };
            return;
        }

        logInfo(`重新初始化视频源: ${sourceId}`);
        const success = await videoSourceManager.initSource(sourceId);
        
        ctx.response.body = { 
            success,
            health: videoSourceManager.getHealthStatus()[sourceId]
        };
    } catch (error) {
        logError('重新初始化视频源失败:', error);
        ctx.response.status = 500;
        ctx.response.body = { error: '重新初始化失败' };
    }
});

// 设置活动视频源
router.post('/api/sources/active', async (ctx) => {
    try {
        const body = await ctx.request.body.json();
        const { id: sourceId } = body;

        // 参数校验
        if (!validateRequiredString(sourceId, 'source')) {
            logWarn('设置活动视频源失败: 缺少或无效的source参数');
            ctx.response.status = 400;
            ctx.response.body = { error: '缺少或无效的source参数' };
            return;
        }

        logDebug(`设置活动视频源: ${sourceId}`);

        const success = videoSourceManager.setActiveSource(sourceId);
        if (success) {
            logInfo(`成功设置活动视频源: ${sourceId}`);
        } else {
            logWarn(`设置活动视频源失败: ${sourceId}`);
        }
        ctx.response.body = { success };
    } catch (error) {
        logError('设置活动视频源请求处理失败:', error);
        ctx.response.status = 500;
        ctx.response.body = { error: '请求处理失败' };
    }
});

// 获取当前活动视频源
router.get('/api/sources/active', (ctx) => {
    logDebug('获取当前活动视频源');
    const activeSource = videoSourceManager.getActiveSource();
    const sourceId = videoSourceManager.getActiveSourceId();
    ctx.response.body = {
        id: sourceId,
        name: activeSource?.getName() || null
    };
});

// 获取主页视频
router.get('/api/home-videos', async (ctx) => {
    try {
        const activeSource = videoSourceManager.getActiveSource();
        const pageParam = ctx.request.url.searchParams.get('page') || '1';

        // 参数校验
        if (!validatePagination(pageParam)) {
            logWarn('获取主页视频失败: 无效的分页参数');
            ctx.response.status = 400;
            ctx.response.body = { error: '无效的分页参数' };
            return;
        }

        const page = parseInt(pageParam);
        logDebug(`获取主页视频, page: ${page}`);

        if (!activeSource) {
            logWarn('没有活动的视频源');
            ctx.response.status = 400;
            ctx.response.body = { error: '没有活动的视频源' };
            return;
        }

        const result = await activeSource.getHomeVideos(page);
        logInfo(`获取到 ${result.videos.length} 个主页视频, 当前页: ${result.currentPage}, 总页数: ${result.totalPages}`);
        ctx.response.body = result;
    } catch (error) {
        logError('获取主页视频失败:', error);
        ctx.response.status = 500;
        ctx.response.body = { error: '获取主页视频失败' };
    }
});

// 搜索视频
router.get('/api/search', async (ctx) => {
    try {
        const activeSource = videoSourceManager.getActiveSource();
        const query = ctx.request.url.searchParams.get('q') || '';
        const pageParam = ctx.request.url.searchParams.get('page') || '1';

        // 参数校验
        if (!validateRequiredString(query, 'query')) {
            logWarn('搜索视频失败: 缺少或无效的搜索查询');
            ctx.response.status = 400;
            ctx.response.body = { error: '缺少或无效的搜索查询' };
            return;
        }

        if (!validatePagination(pageParam)) {
            logWarn('搜索视频失败: 无效的分页参数');
            ctx.response.status = 400;
            ctx.response.body = { error: '无效的分页参数' };
            return;
        }

        const page = parseInt(pageParam);
        logDebug(`搜索视频: ${query}, page: ${page}`);

        if (!activeSource) {
            logWarn('没有活动的视频源');
            ctx.response.status = 400;
            ctx.response.body = { error: '没有活动的视频源' };
            return;
        }

        const results = await activeSource.searchVideos(query, page);
        logInfo(`搜索到 ${results.videos.length} 个视频`);
        ctx.response.body = results;
    } catch (error) {
        logError('搜索视频失败:', error);
        ctx.response.status = 500;
        ctx.response.body = { error: '搜索视频失败' };
    }
});

// ==================== 系列 API（简洁版） ====================

// 获取系列详情（基本信息，不包含完整剧集列表）
router.get('/api/series/:id', async (ctx) => {
    try {
        const seriesId = ctx.params.id;

        if (!seriesId) {
            ctx.response.status = 400;
            ctx.response.body = { error: '缺少系列ID' };
            return;
        }

        logDebug(`获取系列详情: ${seriesId}`);

        const detail = await videoSourceManager.getSeries(seriesId);
        if (!detail) {
            ctx.response.status = 404;
            ctx.response.body = { error: '系列不存在' };
            return;
        }

        ctx.response.body = detail;
    } catch (error) {
        logError('获取系列详情失败:', error);
        ctx.response.status = 500;
        ctx.response.body = { error: '获取系列详情失败' };
    }
});

// 解析视频链接
router.post('/api/parse-video', async (ctx) => {
    try {
        const activeSource = videoSourceManager.getActiveSource();
        const body = await ctx.request.body.json();
        const { url } = body;

        // 参数校验
        if (!validateUrl(url)) {
            logWarn('解析视频链接失败: 缺少或无效的URL参数');
            ctx.response.status = 400;
            ctx.response.body = { error: '缺少或无效的URL参数' };
            return;
        }

        logDebug(`解析视频链接: ${url}`);

        if (!activeSource) {
            logWarn('没有活动的视频源');
            ctx.response.status = 400;
            ctx.response.body = { error: '没有活动的视频源' };
            return;
        }

        const m3u8Results = await activeSource.parseVideoUrl(url);
        logInfo(`解析视频链接成功，获取到 ${m3u8Results.length} 个结果`);
        ctx.response.body = { results: m3u8Results };
    } catch (error) {
        logError('解析视频链接失败:', error);
        ctx.response.status = 500;
        ctx.response.body = { error: '解析视频链接失败' };
    }
});

// 解析M3U8
router.get('/api/parse-m3u8', async (ctx) => {
    try {
        const url = ctx.request.url.searchParams.get('url')!;

        // 参数校验
        if (!validateUrl(url)) {
            logWarn('解析M3U8失败: 缺少或无效的URL参数');
            ctx.response.status = 400;
            ctx.response.body = { error: '缺少或无效的URL参数' };
            return;
        }

        logDebug(`解析M3U8: ${url}`);

        const results = await M3U8Service.fetchAndParseM3U8(url!);
        logInfo(`成功解析M3U8，获取到 ${results.length} 个结果`);
        ctx.response.body = { results };
    } catch (error) {
        logError('解析M3U8失败:', error);
        ctx.response.status = 500;
        ctx.response.body = { error: '解析M3U8失败' };
    }
});

interface ProxyResponse {
    data: Uint8Array | ReadableStream<Uint8Array<ArrayBuffer>>;
    contentType: string;
    status: number;
    headers: Record<string, string>;
}

async function handleProxyRequest(
    encodedUrl: string,
    referer?: string,
    task_id?: string,
    range?: string,
    body_type?: string
): Promise<ProxyResponse> {
    try {
        const originalUrl = decodeURIComponent(encodedUrl);
        if (!task_id)
            logInfo(`Proxy request: ${originalUrl}, referer: ${referer || 'none'}, range: ${range || 'none'}`);

        // 准备请求头
        const requestHeaders: Record<string, string> = {
            'Referer': referer || '',
            'Origin': referer ? new URL(referer).origin : '',
        };

        // 转发 Range 请求头（用于 seek）
        if (range) {
            requestHeaders['Range'] = range;
        }

        // 获取原始内容
        const response = await fetch2(originalUrl, {
            headers: requestHeaders,
        });

        // 处理 206 Partial Content（Range 请求成功）
        if (!response.ok && response.status !== 206) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || 'application/octet-stream';

        // 收集需要透传的响应头
        const responseHeaders: Record<string, string> = {};

        // 透传 Content-Range（Range 请求的响应范围）
        const contentRange = response.headers.get('content-range');
        if (contentRange) {
            responseHeaders['Content-Range'] = contentRange;
        }

        // 透传 Content-Length
        const contentLength = response.headers.get('content-length');
        if (contentLength) {
            responseHeaders['Content-Length'] = contentLength;
        }

        // 对于视频文件，声明支持 Range 请求
        if (contentType.startsWith('video/') || contentType.startsWith('audio/')) {
            responseHeaders['Accept-Ranges'] = 'bytes';
        }

        // 处理M3U8：重写所有URL
        if (originalUrl.includes('.m3u8') || contentType.includes('application/vnd.apple.mpegurl') || body_type == 'm3u8') {
            const parser = new M3U8Parser(originalUrl);
            const text = await response.text();
            const manifest = M3U8Parser.identifyPlaylistType(text) === 'master'
                ? parser.parseMasterPlaylist(text)
                : parser.parseMediaPlaylist(text);

            const rewritten = M3U8Service.serializeManifest(manifest, {
                taskId: task_id,
                referer
            });

            // mark
            if (task_id) {
                const durations = manifest.segments.map(s => s.duration);
                downloadManager.markStart(task_id, manifest.segments.length, durations);
            }

            return {
                data: new TextEncoder().encode(rewritten),
                contentType: 'application/vnd.apple.mpegurl',
                status: 200,
                headers: {},
            };
        }

        if (body_type == 'ts') {
            const data = new Uint8Array(await response.arrayBuffer());
            const fixed = M3U8Service.fixTSStream(data);

            // mark
            if (task_id) {
                const task = downloadManager.markStep(task_id);
                // logInfo(`下载: ${task?.fileName}, 已下载 ${task?.progress?.toFixed(2)} %`);
            }

            return {
                data: fixed,
                contentType: 'video/mp2t',
                status: response.status,
                headers: responseHeaders,
            };
        }

        // 回退到正常（直接视频文件下载）
        if (!response.body) 
            throw new Error('The response from upstream has no body');
        let targetStream = response.body;
        const contentLen = parseInt(response.headers.get('content-length') || '0');
        if (task_id && contentLen) {
            let written = 0;
            // 对于大文件使用更平滑的进度更新（每1%更新一次）
            let lastReportedPercent = 0;
            const transform = new TransformStream<Uint8Array<ArrayBuffer>>({
                transform(chunk, ctrl) {
                    ctrl.enqueue(chunk);
                    written += chunk.byteLength;
                    const currentPercent = Math.floor((written * 100) / contentLen);
                    // 每1%或完成时更新一次，避免频繁更新
                    if (currentPercent > lastReportedPercent || written >= contentLen) {
                        lastReportedPercent = currentPercent;
                        downloadManager.setProgressByBytes(task_id, written, contentLen);
                    }
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
        }
    } catch (error) {
        logError(`Proxy request failed: ${encodedUrl}`, error);
        throw error;
    }
}

// M3U8/视频代理 - 支持 Range 请求（seek）
// OPTIONS 预检请求处理
router.options('/api/proxy/:name', (ctx) => {
    ctx.response.status = 204;
    ctx.response.headers.set('Access-Control-Allow-Origin', '*');
    ctx.response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    ctx.response.headers.set('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization');
    ctx.response.headers.set('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    ctx.response.headers.set('Access-Control-Max-Age', '86400');
});

router.get('/api/proxy/:name', async (ctx) => {
    try {
        const encodedUrl = ctx.request.url.searchParams.get('url');

        // 参数校验
        if (!validateRequiredString(encodedUrl, 'url')) {
            logWarn('代理请求失败: 缺少URL参数');
            ctx.response.status = 400;
            ctx.response.body = { error: '缺少URL参数' };
            return;
        }

        // 获取 Range 请求头（用于视频 seek）
        const rangeHeader = ctx.request.headers.get('range');

        logDebug(`处理代理请求: ${encodedUrl}, Range: ${rangeHeader || 'none'}`);

        const trace_id = ctx.request.url.searchParams.get('taskId');
        const referer = ctx.request.url.searchParams.get('referer');

        const { data, contentType, status, headers } = await handleProxyRequest(
            encodedUrl!,
            referer ?? undefined,
            trace_id ?? undefined,
            rangeHeader ?? undefined,
            ctx.request.url.searchParams.get('type') ?? undefined
        );

        logDebug(`代理请求成功，内容类型: ${contentType}, 状态: ${status}`);

        // 设置响应状态（支持 206 Partial Content）
        ctx.response.status = status;
        ctx.response.body = data;
        ctx.response.type = contentType;

        // 设置 CORS 头
        ctx.response.headers.set('Access-Control-Allow-Origin', '*');
        ctx.response.headers.set('Access-Control-Allow-Headers', 'Range, Content-Type');
        ctx.response.headers.set('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

        // 透传响应头（Content-Range, Content-Length, Accept-Ranges）
        for (const [key, value] of Object.entries(headers)) {
            ctx.response.headers.set(key, value);
        }

        // 对于视频文件，添加 Accept-Ranges 头
        if (contentType.startsWith('video/') || contentType.startsWith('audio/')) {
            ctx.response.headers.set('Accept-Ranges', 'bytes');
        }

        // 设置下载文件名（仅针对 M3U8）
        if (ctx.params.name && (contentType.includes('mpegurl') || encodedUrl!.includes('.m3u8'))) {
            ctx.response.headers.set('Content-Disposition', `attachment; filename="${ctx.params.name}.m3u8"`);
        }
    } catch (error) {
        logError('处理代理请求失败:', error);
        ctx.response.status = 500;
        ctx.response.body = { error: '处理代理请求失败' };
    }
});

// 图片代理
router.get('/api/image-proxy', async (ctx) => {
    try {
        const imageUrl = ctx.request.url.searchParams.get('url')!;
        const sourceId = ctx.request.url.searchParams.get('source')!;

        // 参数校验
        if (!validateUrl(imageUrl)) {
            logWarn('图片代理失败: 缺少或无效的图片URL');
            ctx.response.status = 400;
            ctx.response.body = { error: '缺少或无效的图片URL' };
            return;
        }

        logDebug(`图片代理请求: ${imageUrl}, sourceId: ${sourceId}`);

        // 如果有源ID，使用该源的getImage方法获取图片
        if (sourceId) {
            const source = videoSourceManager.getSource(sourceId);
            if (source) {
                logDebug(`使用源 ${sourceId} 获取图片`);
                const imageData = await source.getImage(imageUrl);
                ctx.response.body = imageData.data;
                ctx.response.type = imageData.contentType;
                return;
            }
        }

        // 如果没有指定源或源不存在，使用默认方式获取图片
        logDebug('使用默认方式获取图片');
        const proxiedImage = await fetch2(imageUrl);
        const imageBuffer = new Uint8Array(await proxiedImage.arrayBuffer());
        ctx.response.body = imageBuffer;
        ctx.response.type = proxiedImage.headers.get('content-type') || 'image/jpeg';
        ctx.response.headers.set('Access-Control-Allow-Origin', '*');
    } catch (error) {
        logError('图片代理失败:', error);
        ctx.response.status = 500;
        ctx.response.body = { error: '图片代理失败' };
    }
});

// 创建下载任务
router.post('/api/downloads', async (ctx) => {
    try {
        const body = await ctx.request.body.json();
        const { url, title, outputPath, quality, referer } = body;

        // 参数校验
        const missingFields = validateRequiredFields(body, ['url', 'title']);
        if (missingFields.length > 0) {
            logWarn(`创建下载任务失败: 缺少必需参数: ${missingFields.join(', ')}`);
            ctx.response.status = 400;
            ctx.response.body = { error: `缺少必需参数: ${missingFields.join(', ')}` };
            return;
        }

        if (!validateUrl(url)) {
            logWarn('创建下载任务失败: 无效的URL参数');
            ctx.response.status = 400;
            ctx.response.body = { error: '无效的URL参数' };
            return;
        }

        logDebug(`创建下载任务: ${title}, url: ${url}, quality: ${quality}`);

        const taskId = downloadManager.createDownloadTask(url, title, outputPath, referer);
        const task = downloadManager.getDownloadTask(taskId);
        logInfo(`成功创建下载任务: ${taskId}`);
        ctx.response.body = { task };
    } catch (error) {
        logError('创建下载任务失败:', error);
        ctx.response.status = 500;
        ctx.response.body = { error: '创建下载任务失败' };
    }
});

// 开始下载
router.post('/api/downloads/:id/start', async (ctx) => {
    try {
        const taskId = ctx.params.id;

        // 参数校验
        if (!validateRequiredString(taskId, 'taskId')) {
            logWarn('开始下载失败: 缺少或无效的任务ID');
            ctx.response.status = 400;
            ctx.response.body = { error: '缺少或无效的任务ID' };
            return;
        }

        logDebug(`开始下载任务: ${taskId}`);

        // 检查任务是否存在
        const task = downloadManager.getDownloadTask(taskId);
        if (!task) {
            ctx.response.status = 404;
            ctx.response.body = { error: '下载任务不存在' };
            return;
        }

        // 检查任务状态
        if (task.status === 'downloading') {
            ctx.response.body = { success: true, message: '任务已在下载中' };
            return;
        }

        if (task.status === 'completed') {
            ctx.response.body = { success: true, message: '任务已下载完成' };
            return;
        }

        // 开始下载（非阻塞，立即返回）
        const success = downloadManager.startDownload(taskId);
        
        logInfo(`下载任务 ${taskId} 已加入队列`);
        ctx.response.body = { 
            success: true, 
            message: '任务已加入下载队列',
            task: downloadManager.getDownloadTask(taskId)
        };
    } catch (error) {
        logError('开始下载失败:', error);
        ctx.response.status = 500;
        ctx.response.body = { error: '开始下载失败' };
    }
});

// 获取下载任务状态
router.get('/api/downloads/:id', (ctx) => {
    try {
        const taskId = ctx.params.id;

        // 参数校验
        if (!validateRequiredString(taskId, 'taskId')) {
            logWarn('获取下载任务状态失败: 缺少或无效的任务ID');
            ctx.response.status = 400;
            ctx.response.body = { error: '缺少或无效的任务ID' };
            return;
        }

        logDebug(`获取下载任务状态: ${taskId}`);
        const task = downloadManager.getDownloadTask(taskId);

        if (!task) {
            logWarn(`下载任务不存在: ${taskId}`);
            ctx.response.status = 404;
            ctx.response.body = { error: '下载任务不存在' };
            return;
        }

        ctx.response.body = { task };
    } catch (error) {
        logError('获取下载任务状态失败:', error);
        ctx.response.status = 500;
        ctx.response.body = { error: '获取下载任务状态失败' };
    }
});

// 获取所有下载任务
router.get('/api/downloads', (ctx) => {
    logDebug('获取所有下载任务');
    const tasks = downloadManager.getAllDownloadTasks();
    ctx.response.body = { tasks };
});

// 取消下载
router.post('/api/downloads/:id/cancel', async (ctx) => {
    try {
        const taskId = ctx.params.id;

        // 参数校验
        if (!validateRequiredString(taskId, 'taskId')) {
            logWarn('取消下载失败: 缺少或无效的任务ID');
            ctx.response.status = 400;
            ctx.response.body = { error: '缺少或无效的任务ID' };
            return;
        }

        logDebug(`取消下载任务: ${taskId}`);

        const success = downloadManager.cancelDownload(taskId);
        if (success) {
            logInfo(`下载任务 ${taskId} 已取消`);
            // 保存状态
            await downloadManager.saveToKV();
        } else {
            logWarn(`取消下载任务 ${taskId} 失败`);
        }
        ctx.response.body = { success };
    } catch (error) {
        logError('取消下载失败:', error);
        ctx.response.status = 500;
        ctx.response.body = { error: '取消下载失败' };
    }
});

// 重试下载
router.post('/api/downloads/:id/retry', async (ctx) => {
    try {
        const taskId = ctx.params.id;

        if (!validateRequiredString(taskId, 'taskId')) {
            ctx.response.status = 400;
            ctx.response.body = { error: '缺少或无效的任务ID' };
            return;
        }

        logDebug(`重试下载任务: ${taskId}`);

        const task = downloadManager.getDownloadTask(taskId);
        if (!task) {
            ctx.response.status = 404;
            ctx.response.body = { error: '下载任务不存在' };
            return;
        }

        const success = await downloadManager.retryDownload(taskId);
        ctx.response.body = { success, task: downloadManager.getDownloadTask(taskId) };
    } catch (error) {
        logError('重试下载失败:', error);
        ctx.response.status = 500;
        ctx.response.body = { error: '重试下载失败' };
    }
});

// 删除下载任务
router.delete('/api/downloads/:id', async (ctx) => {
    try {
        const taskId = ctx.params.id;
        const deleteFile = ctx.request.url.searchParams.get('deleteFile') === 'true';

        if (!validateRequiredString(taskId, 'taskId')) {
            ctx.response.status = 400;
            ctx.response.body = { error: '缺少或无效的任务ID' };
            return;
        }

        logDebug(`删除下载任务: ${taskId}, 删除文件: ${deleteFile}`);

        const success = downloadManager.deleteDownload(taskId, deleteFile);
        if (success) {
            await downloadManager.saveToKV();
        }
        ctx.response.body = { success };
    } catch (error) {
        logError('删除下载任务失败:', error);
        ctx.response.status = 500;
        ctx.response.body = { error: '删除下载任务失败' };
    }
});

// 获取下载统计
router.get('/api/downloads/stats', (ctx) => {
    ctx.response.body = {
        stats: downloadManager.getStats(),
        active: downloadManager.getActiveDownloads().length,
        pending: downloadManager.getPendingDownloads().length,
        queue: downloadManager.getAllDownloadTasks().length
    };
});

// 清除已完成下载
router.post('/api/downloads/clear-completed', async (ctx) => {
    try {
        const body = await ctx.request.body.json().catch(() => ({}));
        const deleteFiles = body.deleteFiles === true;
        
        logDebug(`清除已完成下载任务, 删除文件: ${deleteFiles}`);

        const result = downloadManager.clearCompletedDownloads(deleteFiles);
        
        if (result.count > 0) {
            logInfo(`已清除 ${result.count} 个已完成下载任务，删除 ${result.deletedFiles} 个文件`);
            await downloadManager.saveToKV();
        } else {
            logInfo('没有可清除的已完成下载任务');
        }
        
        ctx.response.body = { 
            success: result.count > 0,
            clearedCount: result.count,
            deletedFiles: result.deletedFiles
        };
    } catch (error) {
        logError('清除已完成下载失败:', error);
        ctx.response.status = 500;
        ctx.response.body = { error: '清除已完成下载失败' };
    }
});

// 健康检查端点
router.get('/api/health', (ctx) => {
    const sourcesHealth = videoSourceManager.getHealthStatus();
    const healthySources = Object.values(sourcesHealth).filter(h => h.status === 'healthy').length;
    const totalSources = Object.keys(sourcesHealth).length;
    
    ctx.response.body = {
        status: healthySources > 0 ? 'ok' : 'degraded',
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
        }
    };
});

// 静态文件服务
app.use(async (ctx, next) => {
    const path = ctx.request.url.pathname;

    // 如果是API请求，跳过
    if (path.startsWith('/api/')) {
        await next();
        return;
    }

    // 尝试提供静态文件
    try {
        await Deno.readFile(`./public${path}`);
        await send(ctx, path, {
            root: './public',
            index: 'index.html'
        });
    } catch {
        // 如果文件不存在，返回index.html（用于SPA）
        try {
            await send(ctx, '/index.html', {
                root: './public'
            });
        } catch {
            ctx.response.status = 404;
            ctx.response.body = 'Not Found';
        }
    }
});

// 注册路由
app.use(router.routes());
app.use(router.allowedMethods());

// 启动服务器
const port = config.server.port;

// 加载持久化的下载任务
try {
    await downloadManager.loadFromKV();
} catch (error) {
    logWarn('加载持久化下载任务失败:', error);
}

// 初始化视频源（使用管理器内部的超时控制）
logInfo('开始初始化视频源...');
try {
    await videoSourceManager.initAllSources();
    logInfo('视频源初始化完成');
} catch (error) {
    logError('视频源初始化失败:', error);
    // 即使初始化失败，也继续启动服务器，但服务可能功能受限
}

// 定期保存下载任务（每30秒）
setInterval(async () => {
    try {
        await downloadManager.saveToKV();
    } catch (error) {
        logError('保存下载任务失败:', error);
    }
}, 30000);

// 优雅关闭处理
const gracefulShutdown = async () => {
    logInfo('正在关闭服务器...');
    
    // 停止健康检查
    videoSourceManager.stopHealthCheck();
    
    // 保存下载任务
    try {
        await downloadManager.saveToKV();
        logInfo('下载任务已保存');
    } catch (error) {
        logError('保存下载任务失败:', error);
    }
    
    // 停止清理定时器
    downloadManager.stopCleanupTimer();
    
    logInfo('服务器已关闭');
    Deno.exit(0);
};

// 监听关闭信号
Deno.addSignalListener('SIGINT', gracefulShutdown);

logInfo(`服务器启动在 http://localhost:${port}`);
if (config.server.verboseLogging) {
    logInfo('Verbose logging is enabled. Set verboseLogging=false in config.json to disable.');
}

export const SERVER_ADDR = 'http://localhost:' + port;
await app.listen({ port });