/**
 * API 响应缓存管理器
 * 支持 TTL（生存时间）的内存缓存
 */

interface CacheEntry<T> {
    data: T;
    expiresAt: number;
}

export class APICache {
    private cache: Map<string, CacheEntry<unknown>> = new Map();
    private defaultTTL: number;

    constructor(defaultTTLMs: number = 20000) {
        this.defaultTTL = defaultTTLMs;
    }

    /**
     * 生成缓存键
     */
    private generateKey(method: string, params: unknown[]): string {
        return `${method}:${JSON.stringify(params)}`;
    }

    /**
     * 获取缓存数据
     */
    get<T>(method: string, params: unknown[]): T | null {
        const key = this.generateKey(method, params);
        const entry = this.cache.get(key);

        if (!entry) {
            return null;
        }

        // 检查是否过期
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }

        return entry.data as T;
    }

    /**
     * 设置缓存数据
     */
    set<T>(method: string, params: unknown[], data: T, ttlMs?: number): void {
        const key = this.generateKey(method, params);
        const expiresAt = Date.now() + (ttlMs ?? this.defaultTTL);
        this.cache.set(key, { data, expiresAt });
    }

    /**
     * 删除缓存
     */
    delete(method: string, params: unknown[]): void {
        const key = this.generateKey(method, params);
        this.cache.delete(key);
    }

    /**
     * 清空所有缓存
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * 清理过期缓存
     */
    cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.expiresAt) {
                this.cache.delete(key);
            }
        }
    }
}

// 全局缓存实例（20秒默认过期）
export const apiCache = new APICache(20000);

// 需要缓存的 API 方法列表
export const CACHEABLE_METHODS = new Set([
    'sources.getAll',
    'sources.getActive',
    'videos.getHome',
    'videos.search',
    'series.getDetail'
]);
