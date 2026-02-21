import { BaseVideoSource } from './sources/index.ts';
import { ISource, ISourceHealth, ISeriesResult, IEpisode, IVideoList } from './types/index.ts';
import { logError, logInfo, logDebug, logWarn } from "./utils/logger.ts";
import { getConfig } from "./config/index.ts";
import { SOURCES } from "./sources.ts";
import { APICache } from "./utils/cache.ts";

// API 缓存实例（20秒过期）
const apiCache = new APICache(20000);

// 带超时的异步操作包装器
function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationName: string
): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`${operationName} 超时(${timeoutMs}ms)`)), timeoutMs)
        )
    ]);
}

// 延迟函数
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 视频源包装器
class SourceWrapper {
    public initialized = false;
    public lastError?: string;

    constructor(public source: BaseVideoSource) { }

    get id(): string {
        return this.source.getId();
    }

    get name(): string {
        return this.source.getName();
    }
}

/**
 * 视频源管理器（简化版）
 */
export class VideoSourceManager {
    private sources: Map<string, SourceWrapper> = new Map();
    private activeSourceId: string | null = null;
    private initialized = false;
    private initPromise: Promise<void> | null = null;

    constructor() {
        for (const source of SOURCES) {
            this.registerSource(new source());
        }

        // 设置默认活动源
        if (this.sources.size > 0) {
            this.activeSourceId = this.sources.keys().next().value || null;
        }
    }

    /**
     * 初始化所有视频源
     */
    async initAllSources(): Promise<void> {
        if (this.initPromise) {
            logDebug('视频源初始化已在进行中，等待完成...');
            return this.initPromise;
        }

        if (this.initialized) {
            logDebug('视频源已初始化，跳过');
            return;
        }

        this.initPromise = this.doInitAllSources();

        try {
            await this.initPromise;
            this.initialized = true;
        } finally {
            this.initPromise = null;
        }
    }

    private async doInitAllSources(): Promise<void> {
        logInfo(`开始初始化 ${this.sources.size} 个视频源...`);

        const results = await Promise.allSettled(
            Array.from(this.sources.values()).map(wrapper => this.initSourceWithRetry(wrapper))
        );

        let successCount = 0;
        let failCount = 0;

        results.forEach((result, index) => {
            const wrapper = Array.from(this.sources.values())[index];
            if (result.status === 'fulfilled' && result.value) {
                successCount++;
                wrapper.initialized = true;
            } else {
                failCount++;
                wrapper.lastError = result.status === 'rejected'
                    ? String(result.reason)
                    : '初始化失败';
                logError(`视频源 ${wrapper.id} 初始化失败:`, wrapper.lastError);
            }
        });

        logInfo(`视频源初始化完成: ${successCount} 成功, ${failCount} 失败`);
    }

    /**
     * 带重试机制的源初始化
     */
    private async initSourceWithRetry(wrapper: SourceWrapper): Promise<boolean> {
        const maxRetries = getConfig().videoSource.initRetryAttempts;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                logDebug(`初始化视频源 ${wrapper.id} (尝试 ${attempt}/${maxRetries})...`);

                await withTimeout(
                    wrapper.source.init(),
                    getConfig().videoSource.initTimeoutMs,
                    `视频源 ${wrapper.id} 初始化`
                );

                logInfo(`视频源 ${wrapper.id} 初始化成功`);
                return true;
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                logWarn(`视频源 ${wrapper.id} 初始化失败 (尝试 ${attempt}): ${errorMsg}`);

                if (attempt < maxRetries) {
                    await delay(getConfig().videoSource.initRetryDelayMs);
                }
            }
        }

        return false;
    }

    /**
     * 初始化指定视频源
     */
    async initSource(sourceId: string): Promise<boolean> {
        const wrapper = this.sources.get(sourceId);
        if (!wrapper) {
            logWarn(`尝试初始化不存在的视频源: ${sourceId}`);
            return false;
        }

        const success = await this.initSourceWithRetry(wrapper);
        if (success) {
            wrapper.initialized = true;
        }
        return success;
    }

    /**
     * 获取健康状态
     */
    getHealthStatus(): Record<string, ISourceHealth> {
        const status: Record<string, ISourceHealth> = {};
        for (const [id, wrapper] of this.sources) {
            status[id] = {
                status: wrapper.initialized ? 'healthy' : 'unhealthy',
                lastCheck: 0,
                consecutiveFailures: 0,
                circuitOpen: false,
                circuitOpenUntil: 0,
                lastError: wrapper.lastError
            };
        }
        return status;
    }

    // ==================== 基础操作 ====================

    registerSource(source: BaseVideoSource): void {
        this.sources.set(source.getId(), new SourceWrapper(source));
    }

    getAllSources(): ISource[] {
        const sources: ISource[] = [];

        for (const [id, wrapper] of this.sources) {
            sources.push({
                id,
                name: wrapper.name,
                baseUrl: wrapper.source.base || '',
                enabled: wrapper.initialized,
                imageAspectRatio: wrapper.source.getImageAspectRatio(),
                health: {
                    status: wrapper.initialized ? 'healthy' : 'unhealthy',
                    lastCheck: 0,
                    consecutiveFailures: 0,
                    circuitOpen: false,
                    circuitOpenUntil: 0,
                    lastError: wrapper.lastError
                }
            });
        }

        return sources;
    }

    getActiveSource(): BaseVideoSource | null {
        if (!this.activeSourceId) return null;
        return this.sources.get(this.activeSourceId)?.source || null;
    }

    setActiveSource(sourceId: string): boolean {
        const wrapper = this.sources.get(sourceId);
        if (!wrapper) return false;

        this.activeSourceId = sourceId;
        logInfo(`活动视频源已切换为: ${sourceId}`);
        return true;
    }

    getSource(sourceId: string): BaseVideoSource | null {
        return this.sources.get(sourceId)?.source || null;
    }

    getActiveSourceId(): string | null {
        return this.activeSourceId;
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    stopHealthCheck(): void {
        // 简化版不需要健康检查
    }

    // ==================== 系列功能 ====================

    /**
     * 获取系列剧集列表
     * @param seriesId - 系列ID
     * @param url - 可选的系列页面URL，如果提供则优先使用
     */
    async getSeries(seriesId: string, url?: string): Promise<ISeriesResult | null> {
        const active = this.getActiveSource();
        if (!active) return null;

        try {
            const list = await active.getSeries(seriesId, url);
            return list ?? null;
        } catch (error) {
            logError(`获取系列 ${seriesId} 失败:`, error);
            return null;
        }
    }

    /**
     * 获取无限系列视频列表
     */
    async getSeriesVideos(seriesId: string): Promise<{ episodes: IEpisode[] } | null> {
        const active = this.getActiveSource();
        if (!active) return null;

        try {
            const result = await active.getSeries(seriesId);
            if (result && result.episodes) {
                return { episodes: result.episodes };
            }
            return null;
        } catch (error) {
            logError(`获取无限系列视频 ${seriesId} 失败:`, error);
            return null;
        }
    }

    // ==================== 带缓存的API方法 ====================

    /**
     * 获取主页视频列表（带缓存）
     */
    async getHomeVideos(page: number = 1): Promise<IVideoList> {
        const active = this.getActiveSource();
        if (!active) {
            throw new Error("没有活动的视频源");
        }

        const cacheKey = `home:${active.getId()}:${page}`;
        const cached = apiCache.get<IVideoList>('home', [cacheKey]);
        if (cached) {
            logDebug(`缓存命中: ${cacheKey}`);
            return cached;
        }

        const result = await active.getHomeVideos(page);
        apiCache.set('home', [cacheKey], result);
        return result;
    }

    /**
     * 搜索视频（带缓存）
     */
    async searchVideos(query: string, page: number = 1): Promise<IVideoList> {
        const active = this.getActiveSource();
        if (!active) {
            throw new Error("没有活动的视频源");
        }

        const cacheKey = `search:${active.getId()}:${query}:${page}`;
        const cached = apiCache.get<IVideoList>('search', [cacheKey]);
        if (cached) {
            logDebug(`缓存命中: ${cacheKey}`);
            return cached;
        }

        const result = await active.searchVideos(query, page);
        apiCache.set('search', [cacheKey], result);
        return result;
    }
}
