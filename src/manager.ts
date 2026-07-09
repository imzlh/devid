import { BaseVideoSource } from "./sources/index.ts";
import {
  IEpisode,
  ISeriesResult,
  ISource,
  ISourceHealth,
  IVideoItem,
  IVideoList,
  IVideoURL,
  URLProxy,
} from "./types/index.ts";
import { logDebug, logError, logInfo, logWarn } from "./utils/logger.ts";
import { getConfig } from "./config/index.ts";
import { SOURCES } from "./sources.ts";
import { APICache } from "./utils/cache.ts";
import { inferMediaFormat } from "./utils/media-format.ts";

// API 缓存实例（20秒过期）
const apiCache = new APICache(20000);

// 带超时的异步操作包装器
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${operationName} 超时(${timeoutMs}ms)`)),
        timeoutMs,
      )
    ),
  ]);
}

// 延迟函数
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeUrlProxy(value: unknown): IVideoURL["proxy"] {
  return value === URLProxy.NONE || value === URLProxy.LOCAL ||
      value === URLProxy.REMOTE
    ? value
    : undefined;
}

export function normalizeVideoUrls(
  results: unknown,
  pageUrl: string,
  sourceId: string,
): IVideoURL[] {
  const normalized: IVideoURL[] = [];
  const sourceResults = Array.isArray(results) ? results : [];
  if (!Array.isArray(results)) {
    logWarn(`视频源 ${sourceId} 返回的播放地址列表不是数组`);
  }

  for (const value of sourceResults) {
    if (!value || typeof value !== "object") {
      logWarn(`视频源 ${sourceId} 返回缺少播放地址的结果`);
      continue;
    }
    const result = value as Partial<IVideoURL>;
    if (typeof result.url !== "string" || !result.url.trim()) {
      logWarn(`视频源 ${sourceId} 返回缺少播放地址的结果`);
      continue;
    }
    try {
      const url = normalizeHttpUrl(result.url.trim(), pageUrl);
      if (!url) {
        logWarn(`视频源 ${sourceId} 返回非HTTP播放地址: ${result.url}`);
        continue;
      }
      const format = inferMediaFormat(url, result.format);
      const quality = nonEmptyString(result.quality) ??
        nonEmptyString(result.resolution) ?? "默认";
      const resolution = nonEmptyString(result.resolution);
      const bandwidth = finitePositiveNumber(result.bandwidth);
      normalized.push({
        url,
        quality,
        resolution,
        bandwidth,
        format,
        referrer: normalizeHttpUrl(result.referrer, pageUrl) || undefined,
        proxy: normalizeUrlProxy(result.proxy) ??
          (format === "m3u8" ? URLProxy.LOCAL : undefined),
      });
    } catch (error) {
      logWarn(`视频源 ${sourceId} 返回无效播放地址: ${result.url}`, error);
    }
  }
  return normalized;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function finitePositiveNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeContentType(value: unknown): IVideoItem["contentType"] {
  return value === "video" || value === "series" || value === "infinite"
    ? value
    : undefined;
}

function normalizeSeriesType(value: unknown): ISeriesResult["type"] {
  return value === "anime" || value === "drama" || value === "movie" ||
      value === "variety" || value === "documentary" || value === "other"
    ? value
    : undefined;
}

function normalizeSeriesStatus(value: unknown): ISeriesResult["status"] {
  return value === "ongoing" || value === "completed" ||
      value === "upcoming" || value === "hiatus"
    ? value
    : undefined;
}

function finitePage(value: unknown, fallback: number): number {
  const parsed = typeof value === "number"
    ? value
    : parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeHttpUrl(value: string | undefined, baseUrl: string): string {
  if (!value) return "";
  try {
    const parsed = new URL(value, baseUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : "";
  } catch {
    return "";
  }
}

export function normalizeVideoList(
  list: Partial<IVideoList> | null | undefined,
  requestedPage: number,
  sourceId: string,
  baseUrl: string,
): IVideoList {
  const currentPage = finitePage(list?.currentPage, requestedPage);
  const totalPages = Math.max(
    currentPage,
    finitePage(list?.totalPages, currentPage),
  );
  const seen = new Set<string>();
  const videos: IVideoItem[] = [];

  const sourceVideos = Array.isArray(list?.videos) ? list.videos : [];
  for (const [index, value] of sourceVideos.entries()) {
    if (!value || typeof value !== "object") {
      logWarn(`视频源 ${sourceId} 返回缺少标题或URL的视频项`);
      continue;
    }
    const video = value as Partial<IVideoItem>;
    const title = nonEmptyString(video.title);
    const itemUrl = nonEmptyString(video.url);
    if (!title || !itemUrl) {
      logWarn(`视频源 ${sourceId} 返回缺少标题或URL的视频项`);
      continue;
    }

    const url = normalizeHttpUrl(itemUrl, baseUrl);
    if (!url) {
      logWarn(`视频源 ${sourceId} 返回非HTTP视频项URL: ${video.url}`);
      continue;
    }

    const normalized: IVideoItem = {
      id: nonEmptyString(video.id) || `${currentPage}:${index}:${itemUrl}`,
      title,
      source: sourceId,
      url,
      thumbnail: normalizeHttpUrl(video.thumbnail, baseUrl),
      duration: nonEmptyString(video.duration),
      views: nonEmptyString(video.views),
      uploadTime: nonEmptyString(video.uploadTime),
      contentType: normalizeContentType(video.contentType),
    };
    const key = `${normalized.source}:${normalized.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    videos.push(normalized);
  }

  return { videos, currentPage, totalPages };
}

export function normalizeSeriesResult(
  result: Partial<ISeriesResult> | null | undefined,
  seriesId: string,
  sourceId: string,
  baseUrl: string,
): ISeriesResult | null {
  if (!result || typeof result !== "object") return null;
  const normalizedSeriesId = nonEmptyString(result.seriesId) ||
    nonEmptyString(result.id) || nonEmptyString(seriesId) ||
    nonEmptyString(result.url) || "series";
  const sourceEpisodes = Array.isArray(result.episodes) ? result.episodes : [];
  const episodes: IEpisode[] = [];
  for (const [index, value] of sourceEpisodes.entries()) {
    if (!value || typeof value !== "object") continue;
    const episode = value as Partial<IEpisode>;
    const rawUrl = nonEmptyString(episode.url);
    const url = normalizeHttpUrl(rawUrl, baseUrl);
    if (!url) continue;
    const fallbackEpisodeNumber = episodes.length + 1;
    episodes.push({
      id: nonEmptyString(episode.id) ||
        `${normalizedSeriesId}:${index}:${rawUrl}`,
      seriesId: nonEmptyString(episode.seriesId) || normalizedSeriesId,
      title: nonEmptyString(episode.title) || `第 ${fallbackEpisodeNumber} 集`,
      episodeNumber: finitePage(episode.episodeNumber, fallbackEpisodeNumber),
      seasonNumber: finitePositiveNumber(episode.seasonNumber),
      thumbnail: normalizeHttpUrl(episode.thumbnail, baseUrl) || undefined,
      duration: nonEmptyString(episode.duration),
      url,
      description: nonEmptyString(episode.description),
      airDate: nonEmptyString(episode.airDate),
    });
  }

  return {
    id: nonEmptyString(result.id) || normalizedSeriesId,
    seriesId: normalizedSeriesId,
    source: sourceId,
    title: nonEmptyString(result.title) || normalizedSeriesId,
    originalTitle: nonEmptyString(result.originalTitle),
    aliases: Array.isArray(result.aliases)
      ? result.aliases.filter((alias) =>
        typeof alias === "string" && alias.trim().length > 0
      )
      : undefined,
    description: nonEmptyString(result.description),
    thumbnail: normalizeHttpUrl(result.thumbnail, baseUrl),
    type: normalizeSeriesType(result.type),
    status: normalizeSeriesStatus(result.status),
    year: finitePositiveNumber(result.year),
    tags: Array.isArray(result.tags)
      ? result.tags.filter((tag) =>
        typeof tag === "string" && tag.trim().length > 0
      )
      : undefined,
    rating: finitePositiveNumber(result.rating),
    views: finitePositiveNumber(result.views),
    url: normalizeHttpUrl(result.url, baseUrl),
    episodes,
    totalEpisodes: Math.max(
      finitePage(result.totalEpisodes, episodes.length),
      episodes.length,
    ),
  };
}

// 视频源包装器
class SourceWrapper {
  public initialized = false;
  public lastError?: string;

  constructor(public source: BaseVideoSource) {}

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
      logDebug("视频源初始化已在进行中，等待完成...");
      return this.initPromise;
    }

    if (this.initialized) {
      logDebug("视频源已初始化，跳过");
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
      Array.from(this.sources.values()).map((wrapper) =>
        this.initSourceWithRetry(wrapper)
      ),
    );

    let successCount = 0;
    let failCount = 0;
    const successfulSources: string[] = [];

    results.forEach((result, index) => {
      const wrapper = Array.from(this.sources.values())[index];
      if (result.status === "fulfilled" && result.value) {
        successCount++;
        wrapper.initialized = true;
        wrapper.lastError = undefined;
        successfulSources.push(wrapper.id);
      } else {
        failCount++;
        wrapper.lastError = result.status === "rejected"
          ? String(result.reason)
          : "初始化失败";
        logError(`视频源 ${wrapper.id} 初始化失败:`, wrapper.lastError);
      }
    });

    // 如果当前活动源初始化失败，自动切换到第一个成功的源
    if (
      this.activeSourceId && !this.sources.get(this.activeSourceId)?.initialized
    ) {
      if (successfulSources.length > 0) {
        const newActiveId = successfulSources[0];
        this.activeSourceId = newActiveId;
        logInfo(`活动视频源自动切换到: ${newActiveId}（原源初始化失败）`);
      } else {
        this.activeSourceId = null;
        logWarn("没有可用的视频源");
      }
    }

    logInfo(`视频源初始化完成: ${successCount} 成功, ${failCount} 失败`);
  }

  /**
   * 带重试机制的源初始化
   */
  private async initSourceWithRetry(wrapper: SourceWrapper): Promise<boolean> {
    const maxRetries = getConfig().videoSource.initRetryAttempts;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logDebug(
          `初始化视频源 ${wrapper.id} (尝试 ${attempt}/${maxRetries})...`,
        );

        await withTimeout(
          wrapper.source.init(),
          getConfig().videoSource.initTimeoutMs,
          `视频源 ${wrapper.id} 初始化`,
        );

        logInfo(`视频源 ${wrapper.id} 初始化成功`);
        return true;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logWarn(
          `视频源 ${wrapper.id} 初始化失败 (尝试 ${attempt}): ${errorMsg}`,
        );

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
    const normalizedSourceId = sourceId.trim();
    const wrapper = this.sources.get(normalizedSourceId);
    if (!wrapper) {
      logWarn(`尝试初始化不存在的视频源: ${normalizedSourceId}`);
      return false;
    }

    const success = await this.initSourceWithRetry(wrapper);
    if (success) {
      wrapper.initialized = true;
      wrapper.lastError = undefined;
    } else {
      wrapper.initialized = false;
      wrapper.lastError = "初始化失败";
      this.ensureActiveSourceAvailable();
    }
    return success;
  }

  private ensureActiveSourceAvailable(): void {
    if (
      this.activeSourceId && this.sources.get(this.activeSourceId)?.initialized
    ) {
      return;
    }

    const fallback = Array.from(this.sources.values()).find((wrapper) =>
      wrapper.initialized
    );
    this.activeSourceId = fallback?.id ?? null;
  }

  private sourceHealth(wrapper: SourceWrapper): ISourceHealth {
    return {
      status: wrapper.initialized ? "healthy" : "unhealthy",
      lastCheck: 0,
      consecutiveFailures: wrapper.initialized ? 0 : 1,
      circuitOpen: false,
      circuitOpenUntil: 0,
      lastError: wrapper.lastError,
    };
  }

  getHealthStatus(): Record<string, ISourceHealth> {
    return Object.fromEntries(
      Array.from(this.sources, ([id, wrapper]) => [
        id,
        this.sourceHealth(wrapper),
      ]),
    );
  }

  getSourceHealth(sourceId: string): ISourceHealth | undefined {
    const wrapper = this.sources.get(sourceId.trim());
    return wrapper ? this.sourceHealth(wrapper) : undefined;
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
        baseUrl: wrapper.source.base || "",
        enabled: wrapper.initialized,
        imageAspectRatio: wrapper.source.getImageAspectRatio(),
        health: this.sourceHealth(wrapper),
      });
    }

    return sources;
  }

  getActiveSource(): BaseVideoSource | null {
    if (!this.activeSourceId) return null;
    const wrapper = this.sources.get(this.activeSourceId);
    return wrapper?.initialized ? wrapper.source : null;
  }

  /**
   * 设置活动视频源
   * 只能切换到初始化成功的视频源
   */
  setActiveSource(sourceId: string): boolean {
    const normalizedSourceId = sourceId.trim();
    const wrapper = this.sources.get(normalizedSourceId);
    if (!wrapper) return false;

    // 只能切换到初始化成功的视频源
    if (!wrapper.initialized) {
      logWarn(`无法切换到未初始化的视频源: ${normalizedSourceId}`);
      return false;
    }

    this.activeSourceId = normalizedSourceId;
    logInfo(`活动视频源已切换为: ${normalizedSourceId}`);
    return true;
  }

  private resolveSourceWrapper(source?: string | null): SourceWrapper | null {
    const requestedSource = source?.trim();
    if (!requestedSource) {
      return this.activeSourceId
        ? this.sources.get(this.activeSourceId) ?? null
        : null;
    }

    const direct = this.sources.get(requestedSource);
    if (direct) return direct;

    const normalized = requestedSource.toLowerCase();
    for (const wrapper of this.sources.values()) {
      if (
        wrapper.name === requestedSource ||
        wrapper.name.toLowerCase() === normalized
      ) {
        return wrapper;
      }
      if (wrapper.id.toLowerCase() === normalized) {
        return wrapper;
      }
    }

    return null;
  }

  getSource(sourceId: string): BaseVideoSource | null {
    const wrapper = this.resolveSourceWrapper(sourceId);
    return wrapper?.initialized ? wrapper.source : null;
  }

  getActiveSourceId(): string | null {
    return this.getActiveSource()?.getId() ?? null;
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
  async getSeries(
    seriesId: string,
    url?: string,
    source?: string,
    page?: number,
  ): Promise<ISeriesResult | null> {
    const target = this.resolveSourceWrapper(source);
    if (!target?.initialized) return null;

    try {
      const list = await target.source.getSeries(seriesId, url, page);
      return normalizeSeriesResult(
        list,
        seriesId,
        target.source.getId(),
        target.source.base,
      );
    } catch (error) {
      logError(`获取系列 ${seriesId} 失败:`, error);
      return null;
    }
  }

  /**
   * 获取无限系列视频列表
   */
  async getSeriesVideos(
    seriesId: string,
    source?: string,
    page = 1,
  ): Promise<{ episodes: IEpisode[] } | null> {
    const target = this.resolveSourceWrapper(source);
    if (!target?.initialized) return null;

    try {
      const result = await target.source.getSeries(seriesId, undefined, page);
      const normalized = normalizeSeriesResult(
        result,
        seriesId,
        target.source.getId(),
        target.source.base,
      );
      if (normalized?.episodes) {
        return { episodes: normalized.episodes };
      }
      return null;
    } catch (error) {
      logError(`获取无限系列视频 ${seriesId} 失败:`, error);
      return null;
    }
  }

  async parseVideoUrl(url: string, source?: string): Promise<IVideoURL[]> {
    const target = this.resolveSourceWrapper(source);
    if (!target?.initialized) {
      throw new Error(source ? `视频源不可用: ${source}` : "没有活动的视频源");
    }
    const results = await target.source.parseVideoUrl(url);
    return normalizeVideoUrls(results, url, target.source.getId());
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
    const cached = apiCache.get<IVideoList>("home", [cacheKey]);
    if (cached) {
      logDebug(`缓存命中: ${cacheKey}`);
      return cached;
    }

    const result = normalizeVideoList(
      await active.getHomeVideos(page),
      page,
      active.getId(),
      active.base || "",
    );
    apiCache.set("home", [cacheKey], result);
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
    const cached = apiCache.get<IVideoList>("search", [cacheKey]);
    if (cached) {
      logDebug(`缓存命中: ${cacheKey}`);
      return cached;
    }

    const result = normalizeVideoList(
      await active.searchVideos(query, page),
      page,
      active.getId(),
      active.base || "",
    );
    apiCache.set("search", [cacheKey], result);
    return result;
  }
}
