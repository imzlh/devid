import type {
  ActiveSource,
  DownloadTask,
  Episode,
  SeriesDetail,
  Source,
  SourceHealthResponse,
  VideoList,
  VideoUrl,
} from "../types/api";
import type { RpcClient } from "./ws";

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
      const transportError = message === "WebSocket is not connected" ||
        message === "WebSocket disconnected" || message === "RPC timeout";
      if (!transportError || !options.fallbackOnTransportError) {
        throw err;
      }
    }
  }

  return fallback();
}

export function getSources(): Promise<Source[]> {
  return call("sources.getAll", [], () => request<Source[]>("/api/sources"), {
    fallbackOnTransportError: true,
  });
}

export function getSourceHealth(): Promise<SourceHealthResponse> {
  return call(
    "sources.getHealth",
    [],
    () => request<SourceHealthResponse>("/api/sources/health"),
    { fallbackOnTransportError: true },
  );
}

export function reinitSource(
  id: string,
): Promise<
  { success: boolean; health?: SourceHealthResponse["health"][string] }
> {
  return call(
    "sources.reinit",
    [id],
    () =>
      request(`/api/sources/${encodeURIComponent(id)}/reinit`, {
        method: "POST",
      }),
  );
}

export function getActiveSource(): Promise<ActiveSource> {
  return call(
    "sources.getActive",
    [],
    () => request<ActiveSource>("/api/sources/active"),
    { fallbackOnTransportError: true },
  );
}

export function setActiveSource(id: string): Promise<{ success: boolean }> {
  return call(
    "sources.setActive",
    [id],
    () =>
      request<{ success: boolean }>("/api/sources/active", {
        method: "POST",
        body: JSON.stringify({ id }),
      }),
  );
}

export function getHomeVideos(page = 1): Promise<VideoList> {
  return call(
    "videos.getHome",
    [page],
    () => request<VideoList>(`/api/home-videos?page=${page}`),
    { fallbackOnTransportError: true },
  );
}

export function searchVideos(query: string, page = 1): Promise<VideoList> {
  const params = new URLSearchParams({ q: query, page: String(page) });
  return call(
    "videos.search",
    [query, page],
    () => request<VideoList>(`/api/search?${params}`),
    { fallbackOnTransportError: true },
  );
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
  );
}

export function getSeriesVideos(
  seriesId: string,
  source?: string,
): Promise<{ episodes: Episode[] }> {
  const params = new URLSearchParams();
  if (source) params.set("source", source);
  const suffix = params.size ? `?${params}` : "";
  return call(
    "series.getVideos",
    [seriesId, source],
    () =>
      request<{ episodes: Episode[] }>(
        `/api/series/${encodeURIComponent(seriesId)}/videos${suffix}`,
      ),
    { fallbackOnTransportError: true },
  );
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
  return payload.results;
}

export async function getDownloads(): Promise<DownloadTask[]> {
  const payload = await call<{ tasks: DownloadTask[] }>(
    "downloads.getAll",
    [],
    () => request<{ tasks: DownloadTask[] }>("/api/downloads"),
    { fallbackOnTransportError: true },
  );
  return payload.tasks;
}

export async function createDownload(
  title: string,
  url: string,
  referer?: string,
): Promise<DownloadTask> {
  const payload = await call<{ task: DownloadTask }>(
    "downloads.create",
    [title, url, undefined, referer],
    () =>
      request<{ task: DownloadTask }>("/api/downloads", {
        method: "POST",
        body: JSON.stringify({ title, url, referer }),
      }),
  );
  return payload.task;
}

export function startDownload(id: string): Promise<{ success: boolean }> {
  return call(
    "downloads.start",
    [id],
    () =>
      request<{ success: boolean }>(`/api/downloads/${id}/start`, {
        method: "POST",
      }),
  );
}

export function cancelDownload(id: string): Promise<{ success: boolean }> {
  return call(
    "downloads.cancel",
    [id],
    () =>
      request<{ success: boolean }>(`/api/downloads/${id}/cancel`, {
        method: "POST",
      }),
  );
}

export function retryDownload(id: string): Promise<{ success: boolean }> {
  return call(
    "downloads.retry",
    [id],
    () =>
      request<{ success: boolean }>(`/api/downloads/${id}/retry`, {
        method: "POST",
      }),
  );
}

export function deleteDownload(
  id: string,
  deleteFile = false,
): Promise<{ success: boolean }> {
  const params = new URLSearchParams({ deleteFile: String(deleteFile) });
  return call(
    "downloads.delete",
    [id, deleteFile],
    () =>
      request<{ success: boolean }>(`/api/downloads/${id}?${params}`, {
        method: "DELETE",
      }),
  );
}

export function clearCompletedDownloads(): Promise<{ success: boolean }> {
  return call(
    "downloads.clearCompleted",
    [false],
    () =>
      request<{ success: boolean }>("/api/downloads/clear-completed", {
        method: "POST",
        body: JSON.stringify({ deleteFiles: false }),
      }),
  );
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
  );
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
  );
}

export function captchaImageUrl(requestId: string): string {
  return `/api/captcha/image?requestId=${encodeURIComponent(requestId)}`;
}

export function proxiedImageUrl(url: string, source?: string): string {
  const params = new URLSearchParams({ url });
  if (source) params.set("source", source);
  return `/api/image-proxy?${params}`;
}
