import { Application, Router, send } from 'oak';
import { VideoSourceManager } from './sources/manager.ts';
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

// 创建应用实例
const app = new Application();
const router = new Router();

// 创建视频源管理器和下载管理器
const videoSourceManager = new VideoSourceManager();
const downloadManager = new DownloadManager();

// 检查是否启用verbose日志
const verboseLogging = Deno.env.get('VERBOSE_LOGGING') === 'true';
if (verboseLogging) {
    enableVerboseLogs();
    logInfo('Verbose logging enabled');
}

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
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    console.info(`${ctx.request.method} ${ctx.request.url} - ${ctx.response.status} - ${ms}ms`);
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
    logInfo(`当前活动视频源: ${sourceId}`);
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

        try {
            const result = await activeSource.getHomeVideos(page);
            logInfo(`获取到 ${result.videos.length} 个主页视频, 当前页: ${result.currentPage}, 总页数: ${result.totalPages}`);
            ctx.response.body = result;
        } catch (error) {
            logError('获取主页视频失败:', error);

            // 如果活动源出错，尝试切换到其他可用源
            const sources = videoSourceManager.getAllSources();
            if (sources.length > 0) {
                const newSourceId = sources[0].id;
                videoSourceManager.setActiveSource(newSourceId);
                logInfo(`已切换到新的活动源: ${newSourceId}`);

                try {
                    // 尝试使用新源获取数据
                    const newSource = videoSourceManager.getActiveSource();
                    if (newSource) {
                        const result = await newSource.getHomeVideos(page);
                        logInfo(`使用新源获取到 ${result.videos.length} 个主页视频, 当前页: ${result.currentPage}, 总页数: ${result.totalPages}`);
                        ctx.response.body = result;
                        return;
                    }
                } catch (newError) {
                    logError('使用新源获取主页视频也失败:', newError instanceof Error ? newError.message : String(newError));
                }
            }

            ctx.response.status = 500;
            ctx.response.body = { error: '获取主页视频失败' };
        }
    } catch (error) {
        logError('获取主页视频请求处理失败:', error);
        ctx.response.status = 500;
        ctx.response.body = { error: '请求处理失败' };
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

        try {
            const results = await activeSource.searchVideos(query, page);
            logInfo(`搜索到 ${results.videos.length} 个视频`);
            ctx.response.body = results;
        } catch (error) {
            logError('搜索视频失败:', error);

            // 如果活动源出错，尝试切换到其他可用源
            const sources = videoSourceManager.getAllSources();
            if (sources.length > 0) {
                const newSourceId = sources[0].id;
                videoSourceManager.setActiveSource(newSourceId);
                logInfo(`已切换到新的活动源: ${newSourceId}`);

                try {
                    // 尝试使用新源获取数据
                    const newSource = videoSourceManager.getActiveSource();
                    if (newSource) {
                        const results = await newSource.searchVideos(query, page);
                        logInfo(`使用新源搜索到 ${results.videos.length} 个视频`);
                        ctx.response.body = results;
                        return;
                    }
                } catch (newError) {
                    logError('使用新源搜索视频也失败:', newError instanceof Error ? newError.message : String(newError));
                }
            }

            ctx.response.status = 500;
            ctx.response.body = { error: '搜索视频失败' };
        }
    } catch (error) {
        logError('搜索视频请求处理失败:', error);
        ctx.response.status = 500;
        ctx.response.body = { error: '请求处理失败' };
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

        try {
            const m3u8Results = await activeSource.parseVideoUrl(url);
            logInfo(`解析视频链接成功，获取到 ${m3u8Results.length} 个结果`);
            ctx.response.body = { results: m3u8Results };
        } catch (error) {
            logError('解析视频链接失败:', error);

            // 如果活动源出错，尝试切换到其他可用源
            const sources = videoSourceManager.getAllSources();
            if (sources.length > 0) {
                const newSourceId = sources[0].id;
                videoSourceManager.setActiveSource(newSourceId);
                logInfo(`已切换到新的活动源: ${newSourceId}`);

                try {
                    // 尝试使用新源获取数据
                    const newSource = videoSourceManager.getActiveSource();
                    if (newSource) {
                        const m3u8Results = await newSource.parseVideoUrl(url);
                        logInfo(`使用新源解析视频链接成功，获取到 ${m3u8Results.length} 个结果`);
                        ctx.response.body = { results: m3u8Results };
                        return;
                    }
                } catch (newError) {
                    logError('使用新源解析视频链接也失败:', newError instanceof Error ? newError.message : String(newError));
                }
            }

            ctx.response.status = 500;
            ctx.response.body = { error: '解析视频链接失败' };
        }
    } catch (error) {
        logError('解析视频链接请求处理失败:', error);
        ctx.response.status = 500;
        ctx.response.body = { error: '请求处理失败' };
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

async function handleProxyRequest(
    encodedUrl: string,
    referer?: string,
    task_id?: string,
): Promise<{ data: Uint8Array; contentType: string }> {
    try {
        const originalUrl = decodeURIComponent(encodedUrl);
        logInfo(`Proxy request: ${originalUrl}, referer: ${referer || 'none'}`);

        // 获取原始内容
        const response = await fetch2(originalUrl, {
            headers: {
                'Referer': referer || '',
                'Origin': referer ? new URL(referer).origin : '',
                'X-Requested-With': 'XMLHttpRequest',
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const contentType = response.headers.get('content-type') || 'application/octet-stream';

        // 处理M3U8：重写所有URL
        if (originalUrl.includes('.m3u8') || contentType.includes('application/vnd.apple.mpegurl')) {
            const parser = new M3U8Parser(originalUrl);
            const text = new TextDecoder().decode(arrayBuffer);
            const manifest = M3U8Parser.identifyPlaylistType(text) === 'master'
                ? parser.parseMasterPlaylist(text)
                : parser.parseMediaPlaylist(text);

            const rewritten = M3U8Service.serializeManifest(manifest, {
                taskId: task_id,
                referer
            });

            // mark
            if (task_id) {
                downloadManager.markStart(task_id, manifest.segments.length);
            }

            return {
                data: new TextEncoder().encode(rewritten),
                contentType: 'application/vnd.apple.mpegurl',
            };
        }

        // 处理TS：修复流数据
        if (originalUrl.includes('.ts') || contentType.includes('video/mp2t')) {
            const data = new Uint8Array(arrayBuffer);
            const fixed = M3U8Service.fixTSStream(data);

            // mark
            if (task_id) {
                downloadManager.markStep(task_id);
            }

            return {
                data: fixed,
                contentType: 'video/mp2t',
            };
        }

        // 其他文件直接返回
        return {
            data: new Uint8Array(arrayBuffer),
            contentType,
        };

    } catch (error) {
        logError(`Proxy request failed: ${encodedUrl}`, error);
        throw error;
    }
}

// M3U8代理
router.get('/api/proxy/:name', async (ctx) => {
    try {
        const encodedUrl = ctx.request.url.searchParams.get('url');
        
        // 参数校验
        if (!validateRequiredString(encodedUrl, 'url')) {
            logWarn('M3U8代理请求失败: 缺少URL参数');
            ctx.response.status = 400;
            ctx.response.body = { error: '缺少URL参数' };
            return;
        }
        
        logDebug(`处理M3U8代理请求: ${encodedUrl}`);

        const trace_id = ctx.request.url.searchParams.get('taskId');
        const referer = ctx.request.url.searchParams.get('referer');
        const { data, contentType } = await handleProxyRequest(encodedUrl!, referer ?? undefined, trace_id ?? undefined);
        logDebug(`M3U8代理请求成功，内容类型: ${contentType}`);

        ctx.response.body = data;
        ctx.response.type = contentType;
        ctx.response.headers.set('Access-Control-Allow-Origin', '*');
        if (ctx.params.name)
            ctx.response.headers.set('Content-Disposition', `attachment; filename="${ctx.params.name}.m3u8"`);
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

        const success = await Promise.race([
            downloadManager.startDownload(taskId),
            new Promise((resolve) => setTimeout(() => resolve(false), 5000))
        ]);
        if (success) {
            logInfo(`下载任务 ${taskId} 已开始`);
        } else {
            logWarn(`下载任务 ${taskId} 开始失败`);
        }
        ctx.response.body = { success };
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

// 清除已完成下载
router.post('/api/downloads/clear-completed', async (ctx) => {
    try {
        logDebug('清除已完成下载任务');
        
        const success = downloadManager.clearCompletedDownloads();
        if (success) {
            logInfo('已成功清除已完成下载任务');
        } else {
            logInfo('没有可清除的已完成下载任务');
        }
        ctx.response.body = { success };
    } catch (error) {
        logError('清除已完成下载失败:', error);
        ctx.response.status = 500;
        ctx.response.body = { error: '清除已完成下载失败' };
    }
});

// 健康检查端点
router.get('/api/health', (ctx) => {
    ctx.response.body = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: performance.now()
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
const port = Number(Deno.env.get('PORT') || '9876');

// 并行初始化所有视频源，设置30秒超时
logInfo('开始并行初始化视频源，超时时间30秒');
const initPromise = videoSourceManager.initAllSources();
const timeoutPromise = new Promise<void>((_, reject) => {
    setTimeout(() => reject(new Error('视频源初始化超时')), 30000);
});

try {
    await Promise.race([initPromise, timeoutPromise]);
    logInfo('所有视频源初始化完成');
} catch (error) {
    logError('视频源初始化失败:', error);
    // 即使初始化失败，也继续启动服务器，但记录错误
}

logInfo(`服务器启动在 http://localhost:${port}`);
if (verboseLogging) {
    logInfo('Verbose logging is enabled. Set VERBOSE_LOGGING=false to disable.');
}

export const SERVER_ADDR = 'http://localhost:' + port;
await app.listen({ port });