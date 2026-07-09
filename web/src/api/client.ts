import {
  type ActiveSource,
  type DownloadTask,
  type Episode,
  type SeriesDetail,
  type Source,
  type SourceHealth,
  type SourceHealthResponse,
  URLProxy,
  type VideoList,
  type VideoUrl,
} from "../types/api.ts";
import type { RpcClient } from "./ws.ts";
import {
  httpUrlOrEmpty,
  inferMediaFormat,
  normalizePlaybackUrls,
} from "../utils/media.ts";

const DOWNLOAD_STATUSES = new Set<DownloadTask["status"]>([
  "pending",
  "downloading",
  "completed",
  "error",
  "cancelled",
]);

function validDownloadStatus(value: unknown): DownloadTask["status"] {
  return typeof value === "string" &&
      DOWNLOAD_STATUSES.has(value as DownloadTask["status"])
    ? value as DownloadTask["status"]
    : "error";
}

function validDateString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return new Date().toISOString();
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? value : new Date().toISOString();
}

function optionalDateString(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? value : undefined;
}

function normalizedProgress(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
}

function normalizedDownloadProxy(value: unknown): DownloadTask["proxy"] {
  return value === URLProxy.NONE || value === URLProxy.LOCAL ||
      value === URLProxy.REMOTE
    ? value
    : undefined;
}

function normalizedDownloadFormat(
  value: unknown,
  url: string,
): DownloadTask["format"] {
  return inferMediaFormat(url, typeof value === "string" ? value : undefined);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function normalizeContentType(
  value: unknown,
): VideoList["videos"][number]["contentType"] {
  return value === "video" || value === "series" || value === "infinite"
    ? value
    : undefined;
}

function normalizeVideoList(value: unknown, requestedPage: number): VideoList {
  const raw = value && typeof value === "object"
    ? value as Partial<VideoList>
    : {};
  const currentPage = positiveInteger(raw.currentPage, requestedPage);
  const totalPages = Math.max(
    currentPage,
    positiveInteger(raw.totalPages, currentPage),
  );
  const videos: VideoList["videos"] = [];
  const seen = new Set<string>();
  const rawVideos = Array.isArray(raw.videos) ? raw.videos : [];
  for (const [index, item] of rawVideos.entries()) {
    if (!item || typeof item !== "object") continue;
    const video = item as Partial<VideoList["videos"][number]>;
    const title = nonEmptyString(video.title);
    const source = nonEmptyString(video.source);
    const url = httpUrlOrEmpty(video.url);
    if (!title || !source || !url) continue;
    const id = nonEmptyString(video.id) || `${currentPage}:${index}:${url}`;
    const key = `${source}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    videos.push({
      id,
      title,
      thumbnail: httpUrlOrEmpty(video.thumbnail),
      duration: nonEmptyString(video.duration),
      views: nonEmptyString(video.views),
      uploadTime: nonEmptyString(video.uploadTime),
      url,
      source,
      contentType: normalizeContentType(video.contentType),
    });
  }
  return { videos, currentPage, totalPages };
}

function normalizeSourceHealth(value: unknown): SourceHealth | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<SourceHealth>;
  const status = raw.status === "healthy" || raw.status === "unhealthy" ||
      raw.status === "unknown"
    ? raw.status
    : "unknown";
  return {
    status,
    lastCheck: positiveInteger(raw.lastCheck, 0),
    consecutiveFailures: positiveInteger(raw.consecutiveFailures, 0),
    circuitOpen: raw.circuitOpen === true,
    circuitOpenUntil: positiveInteger(raw.circuitOpenUntil, 0),
    lastError: nonEmptyString(raw.lastError),
  };
}

export function normalizeSources(value: unknown): Source[] {
  if (!Array.isArray(value)) return [];
  const sources: Source[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const source = item as Partial<Source>;
    const id = nonEmptyString(source.id);
    const name = nonEmptyString(source.name);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    sources.push({
      id,
      name,
      baseUrl: httpUrlOrEmpty(source.baseUrl),
      enabled: source.enabled !== false,
      imageAspectRatio: nonEmptyString(source.imageAspectRatio),
      health: normalizeSourceHealth(source.health),
    });
  }
  return sources;
}

export function normalizeActiveSource(value: unknown): ActiveSource {
  const raw = value && typeof value === "object"
    ? value as Partial<ActiveSource>
    : {};
  return {
    id: nonEmptyString(raw.id) || null,
    name: nonEmptyString(raw.name) || null,
    imageAspectRatio: nonEmptyString(raw.imageAspectRatio) || "16/9",
  };
}

export function normalizeSourceHealthMap(
  value: unknown,
): Record<string, SourceHealth> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const health: Record<string, SourceHealth> = {};
  for (const [sourceId, sourceHealth] of Object.entries(value)) {
    const normalizedSourceId = nonEmptyString(sourceId);
    if (!normalizedSourceId) continue;
    const normalized = normalizeSourceHealth(sourceHealth);
    if (normalized) health[normalizedSourceId] = normalized;
  }
  return Object.keys(health).length > 0 ? health : null;
}

export function normalizeSourceHealthResponse(
  value: unknown,
): SourceHealthResponse {
  const raw = value && typeof value === "object"
    ? value as Partial<SourceHealthResponse>
    : {};
  const rawHealth = raw.health && typeof raw.health === "object"
    ? raw.health as Record<string, unknown>
    : {};
  return {
    health: normalizeSourceHealthMap(rawHealth) ?? {},
    initialized: raw.initialized === true,
    activeSourceId: nonEmptyString(raw.activeSourceId) || null,
  };
}

export function normalizeDownloadTasks(value: unknown): DownloadTask[] {
  if (!Array.isArray(value)) return [];
  const tasks: DownloadTask[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const task = item as Partial<DownloadTask>;
    const id = stringOr(task.id, "");
    const url = httpUrlOrEmpty(task.url);
    if (!id || !url || seen.has(id)) continue;
    seen.add(id);
    const title = stringOr(task.title, "未命名下载");
    const fileName = stringOr(task.fileName, `${title}.mp4`);
    const outputPath = stringOr(task.outputPath, "");
    tasks.push({
      id,
      url,
      referer: httpUrlOrEmpty(task.referer) || undefined,
      title,
      outputPath,
      fileName,
      filePath: stringOr(
        task.filePath,
        outputPath ? `${outputPath}/${fileName}` : fileName,
      ),
      format: normalizedDownloadFormat(task.format, url),
      proxy: normalizedDownloadProxy(task.proxy),
      status: validDownloadStatus(task.status),
      progress: normalizedProgress(task.progress),
      createTime: validDateString(task.createTime),
      startTime: optionalDateString(task.startTime),
      endTime: optionalDateString(task.endTime),
      error: nonEmptyString(task.error),
      totalSegments: positiveInteger(task.totalSegments, 0) || undefined,
      retryCount: positiveInteger(task.retryCount, 0),
      maxRetries: positiveInteger(task.maxRetries, 0) || undefined,
    });
  }
  return tasks;
}

export function normalizeSuccessResponse(value: unknown): { success: boolean } {
  const raw = value && typeof value === "object"
    ? value as { success?: unknown }
    : {};
  return { success: raw.success === true };
}

export function normalizeClearCompletedResponse(value: unknown): {
  success: boolean;
  clearedCount: number;
  deletedFiles: number;
} {
  const raw = value && typeof value === "object"
    ? value as {
      success?: unknown;
      clearedCount?: unknown;
      deletedFiles?: unknown;
    }
    : {};
  return {
    success: raw.success === true,
    clearedCount: positiveInteger(raw.clearedCount, 0),
    deletedFiles: positiveInteger(raw.deletedFiles, 0),
  };
}

export function normalizeReinitSourceResponse(value: unknown): {
  success: boolean;
  health?: SourceHealth;
  activeSourceId?: string | null;
} {
  const raw = value && typeof value === "object"
    ? value as {
      success?: unknown;
      health?: unknown;
      activeSourceId?: unknown;
    }
    : {};
  return {
    success: raw.success === true,
    health: normalizeSourceHealth(raw.health),
    activeSourceId: raw.activeSourceId === null
      ? null
      : nonEmptyString(raw.activeSourceId),
  };
}

const JSON_HEADERS = { "Content-Type": "application/json" };
let rpcClient: RpcClient | null = null;

export function setRpcClient(client: RpcClient | null): void {
  rpcClient = client;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: init?.body ? JSON_HEADERS : undefined,
    ...init,
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
    } catch {
      // keep HTTP status message
    }
    throw new Error(message);
  }

  return await response.json() as T;
}

async function call<T>(
  method: string,
  params: unknown[],
  fallback: () => Promise<T>,
  options: { fallbackOnTransportError?: boolean } = {},
): Promise<T> {
  if (rpcClient?.connected) {
    try {
      return await rpcClient.call<T>(method, params);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const safeToFallback = message === "WebSocket is not connected" ||
        message.startsWith("WebSocket send failed");
      const retryableReadTransportError =
        message === "WebSocket disconnected" ||
        message === "RPC timeout";
      if (
        !safeToFallback &&
        (!retryableReadTransportError || !options.fallbackOnTransportError)
      ) {
        throw err;
      }
    }
  }

  return fallback();
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "number"
    ? value
    : /^\d+$/.test(String(value ?? "").trim())
    ? Number(String(value).trim())
    : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeEpisodes(
  value: unknown,
  fallbackSeriesId: string,
): Episode[] {
  if (!Array.isArray(value)) return [];
  const episodes: Episode[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object") continue;
    const episode = item as Partial<Episode>;
    const url = httpUrlOrEmpty(episode.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const seriesId = nonEmptyString(episode.seriesId) || fallbackSeriesId;
    const fallbackNumber = episodes.length + 1;
    episodes.push({
      id: nonEmptyString(episode.id) || `${seriesId}:${index}:${url}`,
      seriesId,
      title: nonEmptyString(episode.title) || `第 ${fallbackNumber} 集`,
      episodeNumber: positiveInteger(episode.episodeNumber, fallbackNumber),
      seasonNumber: positiveInteger(episode.seasonNumber, 0) || undefined,
      thumbnail: httpUrlOrEmpty(episode.thumbnail) || undefined,
      duration: nonEmptyString(episode.duration),
      url,
      description: nonEmptyString(episode.description),
      airDate: nonEmptyString(episode.airDate),
    });
  }
  return episodes;
}

function normalizeSeriesDetail(
  value: unknown,
  fallbackSeriesId: string,
  fallbackSource?: string,
): SeriesDetail {
  const raw = value && typeof value === "object"
    ? value as Partial<SeriesDetail>
    : {};
  const seriesId = nonEmptyString(raw.seriesId) || nonEmptyString(raw.id) ||
    fallbackSeriesId;
  const episodes = normalizeEpisodes(raw.episodes, seriesId);
  return {
    id: nonEmptyString(raw.id) || seriesId,
    seriesId,
    title: nonEmptyString(raw.title) || seriesId,
    originalTitle: nonEmptyString(raw.originalTitle),
    description: nonEmptyString(raw.description),
    thumbnail: httpUrlOrEmpty(raw.thumbnail),
    totalEpisodes: Math.max(
      positiveInteger(raw.totalEpisodes, episodes.length),
      episodes.length,
    ),
    source: nonEmptyString(raw.source) || fallbackSource || "",
    url: httpUrlOrEmpty(raw.url),
    episodes,
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((tag): tag is string =>
        typeof tag === "string" && tag.trim().length > 0
      )
      : undefined,
    year: positiveInteger(raw.year, 0) || undefined,
    status: nonEmptyString(raw.status),
  };
}

export function getSources(): Promise<Source[]> {
  return call("sources.getAll", [], () => request<Source[]>("/api/sources"), {
    fallbackOnTransportError: true,
  }).then(normalizeSources);
}

export function getSourceHealth(): Promise<SourceHealthResponse> {
  return call(
    "sources.getHealth",
    [],
    () => request<SourceHealthResponse>("/api/sources/health"),
    { fallbackOnTransportError: true },
  ).then(normalizeSourceHealthResponse);
}

export function reinitSource(
  id: string,
): Promise<
  {
    success: boolean;
    health?: SourceHealthResponse["health"][string];
    activeSourceId?: string | null;
  }
> {
  return call(
    "sources.reinit",
    [id],
    () =>
      request(`/api/sources/${encodeURIComponent(id)}/reinit`, {
        method: "POST",
      }),
  ).then(normalizeReinitSourceResponse);
}

export function getActiveSource(): Promise<ActiveSource> {
  return call(
    "sources.getActive",
    [],
    () => request<ActiveSource>("/api/sources/active"),
    { fallbackOnTransportError: true },
  ).then(normalizeActiveSource);
}

export function setActiveSource(
  id: string,
): Promise<{ success: boolean } & ActiveSource> {
  return call(
    "sources.setActive",
    [id],
    () =>
      request<{ success: boolean } & ActiveSource>("/api/sources/active", {
        method: "POST",
        body: JSON.stringify({ id }),
      }),
  ).then((payload) => ({
    success: payload?.success === true,
    ...normalizeActiveSource(payload),
  }));
}

export function getHomeVideos(page = 1): Promise<VideoList> {
  return call(
    "videos.getHome",
    [page],
    () => request<VideoList>(`/api/home-videos?page=${page}`),
    { fallbackOnTransportError: true },
  ).then((payload) => normalizeVideoList(payload, page));
}

export function searchVideos(query: string, page = 1): Promise<VideoList> {
  const params = new URLSearchParams({ q: query, page: String(page) });
  return call(
    "videos.search",
    [query, page],
    () => request<VideoList>(`/api/search?${params}`),
    { fallbackOnTransportError: true },
  ).then((payload) => normalizeVideoList(payload, page));
}

export function getSeriesDetail(
  seriesId: string,
  url?: string,
  source?: string,
): Promise<SeriesDetail> {
  const params = new URLSearchParams();
  if (url) params.set("url", url);
  if (source) params.set("source", source);
  const suffix = params.size ? `?${params}` : "";
  return call(
    "series.getDetail",
    [seriesId, url, source],
    () =>
      request<SeriesDetail>(
        `/api/series/${encodeURIComponent(seriesId)}${suffix}`,
      ),
    { fallbackOnTransportError: true },
  ).then((payload) => normalizeSeriesDetail(payload, seriesId, source));
}

export function getSeriesVideos(
  seriesId: string,
  source?: string,
  page = 1,
): Promise<{ episodes: Episode[] }> {
  const params = new URLSearchParams();
  if (source) params.set("source", source);
  params.set("page", String(page));
  const suffix = params.size ? `?${params}` : "";
  return call(
    "series.getVideos",
    [seriesId, source, page],
    () =>
      request<{ episodes: Episode[] }>(
        `/api/series/${encodeURIComponent(seriesId)}/videos${suffix}`,
      ),
    { fallbackOnTransportError: true },
  ).then((payload) => ({
    episodes: normalizeEpisodes(payload?.episodes, seriesId),
  }));
}

export async function parseVideo(
  url: string,
  source?: string,
): Promise<VideoUrl[]> {
  const payload = await call<{ results: VideoUrl[] }>(
    "videos.parse",
    [url, source],
    () =>
      request<{ results: VideoUrl[] }>("/api/parse-video", {
        method: "POST",
        body: JSON.stringify({ url, source }),
      }),
    { fallbackOnTransportError: true },
  );
  return normalizePlaybackUrls(payload?.results);
}

export async function getDownloads(): Promise<DownloadTask[]> {
  const payload = await call<{ tasks: DownloadTask[] }>(
    "downloads.getAll",
    [],
    () => request<{ tasks: DownloadTask[] }>("/api/downloads"),
    { fallbackOnTransportError: true },
  );
  return normalizeDownloadTasks(payload?.tasks);
}

export async function createDownload(
  title: string,
  url: string,
  referer?: string,
  media?: Pick<VideoUrl, "format" | "proxy">,
): Promise<DownloadTask> {
  const payload = await call<{ task: DownloadTask }>(
    "downloads.create",
    [title, url, undefined, referer, media?.format, media?.proxy],
    () =>
      request<{ task: DownloadTask }>("/api/downloads", {
        method: "POST",
        body: JSON.stringify({
          title,
          url,
          referer,
          format: media?.format,
          proxy: media?.proxy,
        }),
      }),
  );
  const [task] = normalizeDownloadTasks([payload?.task]);
  if (!task) throw new Error("下载任务响应无效");
  return task;
}

export function startDownload(id: string): Promise<{ success: boolean }> {
  const encodedId = encodeURIComponent(id);
  return call(
    "downloads.start",
    [id],
    () =>
      request<{ success: boolean }>(`/api/downloads/${encodedId}/start`, {
        method: "POST",
      }),
  ).then(normalizeSuccessResponse);
}

export function cancelDownload(id: string): Promise<{ success: boolean }> {
  const encodedId = encodeURIComponent(id);
  return call(
    "downloads.cancel",
    [id],
    () =>
      request<{ success: boolean }>(`/api/downloads/${encodedId}/cancel`, {
        method: "POST",
      }),
  ).then(normalizeSuccessResponse);
}

export function retryDownload(id: string): Promise<{ success: boolean }> {
  const encodedId = encodeURIComponent(id);
  return call(
    "downloads.retry",
    [id],
    () =>
      request<{ success: boolean }>(`/api/downloads/${encodedId}/retry`, {
        method: "POST",
      }),
  ).then(normalizeSuccessResponse);
}

export function deleteDownload(
  id: string,
  deleteFile = false,
): Promise<{ success: boolean }> {
  const encodedId = encodeURIComponent(id);
  const params = new URLSearchParams({ deleteFile: String(deleteFile) });
  return call(
    "downloads.delete",
    [id, deleteFile],
    () =>
      request<{ success: boolean }>(`/api/downloads/${encodedId}?${params}`, {
        method: "DELETE",
      }),
  ).then(normalizeSuccessResponse);
}

export function clearCompletedDownloads(): Promise<{
  success: boolean;
  clearedCount: number;
  deletedFiles: number;
}> {
  return call(
    "downloads.clearCompleted",
    [false],
    () =>
      request<{
        success: boolean;
        clearedCount: number;
        deletedFiles: number;
      }>("/api/downloads/clear-completed", {
        method: "POST",
        body: JSON.stringify({ deleteFiles: false }),
      }),
  ).then(normalizeClearCompletedResponse);
}

export function submitCaptcha(
  requestId: string,
  answer: string,
): Promise<{ success: boolean }> {
  return call(
    "captcha.submit",
    [requestId, answer],
    () =>
      request<{ success: boolean }>("/api/captcha/submit", {
        method: "POST",
        body: JSON.stringify({ requestId, answer }),
      }),
  ).then(normalizeSuccessResponse);
}

export function cancelCaptcha(
  requestId: string,
  reason = "用户取消",
): Promise<{ success: boolean }> {
  return call(
    "captcha.cancel",
    [requestId, reason],
    () =>
      request<{ success: boolean }>("/api/captcha/cancel", {
        method: "POST",
        body: JSON.stringify({ requestId, reason }),
      }),
  ).then(normalizeSuccessResponse);
}

export function captchaImageUrl(requestId: string): string {
  return `/api/captcha/image?requestId=${encodeURIComponent(requestId)}`;
}

export function proxiedImageUrl(url: string, source?: string): string {
  const safeUrl = httpUrlOrEmpty(url);
  if (!safeUrl) return "";
  const params = new URLSearchParams({ url: safeUrl });
  if (source) params.set("source", source);
  return `/api/image-proxy?${params}`;
}
