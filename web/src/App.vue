<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  ArrowDown,
  ArrowUp,
  CircleDot,
  Clock,
  Download,
  Home,
  LoaderCircle,
  Moon,
  RefreshCw,
  Search,
  Sun,
  Trash2,
  X,
} from "@lucide/vue";
import VideoGrid from "./components/VideoGrid.vue";
import DownloadsPanel from "./components/DownloadsPanel.vue";
import PlayerPanel from "./components/PlayerPanel.vue";
import SeriesPanel from "./components/SeriesPanel.vue";
import ShortVideoPanel from "./components/ShortVideoPanel.vue";
import CaptchaDialog from "./components/CaptchaDialog.vue";
import ToastViewport, { type ToastItem } from "./components/ToastViewport.vue";
import {
  cancelCaptcha,
  cancelDownload,
  clearCompletedDownloads,
  createDownload,
  deleteDownload,
  getActiveSource,
  getDownloads,
  getHomeVideos,
  getSourceHealth,
  getSources,
  normalizeDownloadTasks,
  normalizeSourceHealthMap,
  parseVideo,
  reinitSource,
  retryDownload,
  searchVideos,
  setActiveSource,
  setRpcClient,
  startDownload,
} from "./api/client";
import { RpcClient } from "./api/ws";
import type {
  DownloadTask,
  CaptchaRequest,
  Episode,
  SeriesDetail,
  Source,
  SourceHealth,
  VideoItem,
  VideoList,
  PageKey,
} from "./types/api";
import { bestQuality, httpUrlOrEmpty } from "./utils/media";
import { chooseAvailableSourceId, sourceIsAvailable } from "./utils/source";
import {
  clearRecentVideos,
  getProgressPercent,
  getRecentVideos,
  removeRecentVideo,
} from "./utils/progress";
import { readRouteState, writeRouteState } from "./utils/hash";

type Theme = "dark" | "light";

const sources = ref<Source[]>([]);
const sourceHealth = ref<Record<string, SourceHealth>>({});
const activeSourceId = ref<string | null>(null);
const videos = ref<VideoList>({ videos: [], currentPage: 1, totalPages: 1 });
const recentVideos = ref<VideoList>({ videos: [], currentPage: 1, totalPages: 1 });
const recentProgress = computed(() =>
  Object.fromEntries(
    recentVideos.value.videos.map((video) => [
      `${video.source}:${video.id}`,
      getProgressPercent(video),
    ]),
  )
);
const downloads = ref<DownloadTask[]>([]);
const page = ref<PageKey>("home");
const query = ref("");
const activeSearchQuery = ref("");
const loading = ref(false);
const loadingMore = ref(false);
const error = ref("");
const theme = ref<Theme>("dark");
const searchInput = ref<HTMLInputElement | null>(null);
const overlaySearchInput = ref<HTMLInputElement | null>(null);
const searchOverlayOpen = ref(false);
const selectedVideo = ref<VideoItem | null>(null);
const selectedSeries = ref<VideoItem | null>(null);
const selectedShortSeries = ref<VideoItem | null>(null);
const captchaRequest = ref<CaptchaRequest | null>(null);
const toasts = ref<ToastItem[]>([]);
const downloadingItems = ref<Set<string>>(new Set());
const seriesBatchDownloading = ref(false);
const sourceActionId = ref<string | null>(null);
const sourceActionKind = ref<"switch" | "reinit" | null>(null);
const isScrolled = ref(false);
const rpc = new RpcClient();
let offDownloadUpdate: (() => void) | null = null;
let offDownloadComplete: (() => void) | null = null;
let offDownloadError: (() => void) | null = null;
let offCaptchaRequired: (() => void) | null = null;
let offCaptchaResolved: (() => void) | null = null;
let offCaptchaCancelled: (() => void) | null = null;
let offSourceChange: (() => void) | null = null;
let offSourceHealth: (() => void) | null = null;
let sourceSyncTimer: ReturnType<typeof setInterval> | null = null;
let downloadPollTimer: ReturnType<typeof setInterval> | null = null;
let pageRequestId = 0;
let toastId = 0;
const toastTimers = new Set<ReturnType<typeof window.setTimeout>>();
const scrollListenerOptions = { passive: true, capture: true } as const;
const scrolledEnterThreshold = 28;
const scrolledExitThreshold = 4;

const activeSource = computed(() =>
  sources.value.find((source) =>
    source.id === activeSourceId.value && sourceAvailable(source)
  ) ?? null
);
const sourceAspectRatios = computed(() =>
  Object.fromEntries(
    sources.value.flatMap((source) => {
      const ratio = source.imageAspectRatio || "16/9";
      return [[source.id, ratio], [source.name, ratio]];
    }),
  )
);
const sourceImageProxyIds = computed(() =>
  Object.fromEntries(
    sources.value.flatMap((source) => [
      [source.id, source.id],
      [source.name, source.id],
    ]),
  )
);
const activeImageAspectRatio = computed(() =>
  activeSource.value?.imageAspectRatio || "16/9"
);
const activeDownloads = computed(() =>
  downloads.value.filter((task) =>
    task.status === "downloading" || task.status === "pending"
  ).length
);
const taskActionLabel = computed(() =>
  activeDownloads.value > 0 ? `当前任务 ${activeDownloads.value}` : "下载任务"
);
const currentList = computed(() =>
  page.value === "recent" ? recentVideos.value : videos.value
);
const mediaModalOpen = computed(() =>
  Boolean(selectedVideo.value || selectedSeries.value || selectedShortSeries.value)
);
const canLoadMoreVideos = computed(() =>
  (page.value === "home" || page.value === "search") &&
  videos.value.currentPage < videos.value.totalPages
);
const pageSummary = computed(() => {
  if (page.value === "downloads") {
    return `${downloads.value.length} 个任务，${activeDownloads.value} 个进行中`;
  }
  if (page.value === "sources") {
    return `${sources.value.length} 个视频源，当前 ${activeSource.value?.name ?? "未选择"}`;
  }
  const total = currentList.value.videos.length;
  const pageText = currentList.value.totalPages > 1
    ? `已加载 ${currentList.value.currentPage} / ${currentList.value.totalPages} 页`
    : "当前页";
  if (page.value === "search") {
    return activeSearchQuery.value
      ? `“${activeSearchQuery.value}” · ${total} 个结果 · ${pageText}`
      : "输入关键词开始搜索";
  }
  if (page.value === "recent") return `${total} 个最近观看`;
  return `${total} 个视频 · ${pageText}`;
});
const videoEmptyTitle = computed(() => {
  if (page.value === "recent") return "还没有最近观看";
  if (page.value === "search") return "没有搜索结果";
  return "没有视频";
});
const videoEmptyText = computed(() => {
  if (page.value === "recent") return "播放视频后会在这里继续观看";
  if (page.value === "search") return "换个关键词或切换视频源试试";
  return "切换视频源或稍后刷新试试";
});

function applyTheme(nextTheme: Theme) {
  theme.value = nextTheme;
  document.documentElement.dataset.theme = nextTheme;
  try {
    localStorage.setItem("vdown:theme", nextTheme);
  } catch {
    // Theme still applies for the current session when storage is unavailable.
  }
}

function initTheme() {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem("vdown:theme");
  } catch {
    stored = null;
  }
  if (stored === "dark" || stored === "light") {
    applyTheme(stored);
    return;
  }

  const prefersLight = globalThis.matchMedia?.("(prefers-color-scheme: light)")
    .matches;
  applyTheme(prefersLight ? "light" : "dark");
}

function toggleTheme() {
  applyTheme(theme.value === "dark" ? "light" : "dark");
}

function notify(type: ToastItem["type"], message: string, timeout = 2600) {
  const id = ++toastId;
  toasts.value = [{ id, type, message }];
  const timer = window.setTimeout(() => {
    toastTimers.delete(timer);
    dismissToast(id);
  }, timeout);
  toastTimers.add(timer);
}

function dismissToast(id: number) {
  toasts.value = toasts.value.filter((toast) => toast.id !== id);
}

function sourceStatus(source: Source): SourceHealth["status"] {
  return sourceHealth.value[source.id]?.status ?? source.health?.status ?? "unknown";
}

function normalizePushedCaptchaRequest(value: unknown): CaptchaRequest | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CaptchaRequest>;
  const requestId = nonEmptyText(raw.requestId);
  if (!requestId) return null;
  const createdAt = Number(raw.createdAt);
  return {
    requestId,
    captchaPageUrl: nonEmptyText(raw.captchaPageUrl) || undefined,
    prompt: nonEmptyText(raw.prompt) || "请输入验证码",
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
  };
}

function sourceAvailable(
  source: Source,
  healthMap: Record<string, SourceHealth> = sourceHealth.value,
): boolean {
  return sourceIsAvailable(source, healthMap);
}

function sourceStatusLabel(source: Source): string {
  const status = sourceStatus(source);
  if (status === "healthy") return "正常";
  if (status === "unhealthy") return "异常";
  return "未知";
}

function sourceStatusTitle(source: Source): string {
  const health = sourceHealth.value[source.id] ?? source.health;
  if (!health) return "暂未获取健康状态";
  if (health.lastError) return health.lastError;
  if (health.circuitOpen) return "该视频源暂时熔断";
  return sourceStatusLabel(source);
}

function baseHost(source: Source): string {
  if (!source.baseUrl) return source.id;
  try {
    return new URL(source.baseUrl).host;
  } catch {
    return source.baseUrl;
  }
}

function videoKey(video: VideoItem): string {
  return `${video.source}:${video.id}`;
}

const downloadingItemMap = computed(() =>
  Object.fromEntries(Array.from(downloadingItems.value).map((key) => [key, true]))
);

function markItemDownloading(video: VideoItem, downloading: boolean) {
  const next = new Set(downloadingItems.value);
  const key = videoKey(video);
  if (downloading) next.add(key);
  else next.delete(key);
  downloadingItems.value = next;
}

function mergeVideoList(current: VideoList, next: VideoList): VideoList {
  const seen = new Set(current.videos.map(videoKey));
  const appended = next.videos.filter((video) => {
    const key = videoKey(video);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    videos: [...current.videos, ...appended],
    currentPage: next.currentPage,
    totalPages: next.totalPages,
  };
}

async function loadSources() {
  const [allSources, active, health] = await Promise.all([
    getSources(),
    getActiveSource().catch(() => null),
    getSourceHealth().catch(() => null),
  ]);
  const nextHealth = health?.health ??
    Object.fromEntries(
      allSources
        .filter((source) => source.health)
        .map((source) => [source.id, source.health as SourceHealth]),
    );
  sources.value = allSources;
  sourceHealth.value = nextHealth;
  activeSourceId.value = chooseAvailableSourceId(
    allSources,
    active?.id,
    nextHealth,
  );
}

async function loadHome(nextPage = 1, scroll = true, append = false) {
  const requestId = ++pageRequestId;
  if (append) loadingMore.value = true;
  else {
    loading.value = true;
    loadingMore.value = false;
    activeSearchQuery.value = "";
  }
  error.value = "";
  page.value = "home";
  try {
    const nextVideos = await getHomeVideos(nextPage);
    if (requestId !== pageRequestId) return;
    videos.value = append ? mergeVideoList(videos.value, nextVideos) : nextVideos;
    if (scroll && !append) scrollToTop();
  } catch (err) {
    if (requestId !== pageRequestId) return;
    error.value = err instanceof Error ? err.message : String(err);
    notify("error", error.value);
  } finally {
    if (requestId === pageRequestId) {
      if (append) loadingMore.value = false;
      else loading.value = false;
    }
  }
}

async function runSearch(nextPage = 1, scroll = true, append = false) {
  const term = append ? activeSearchQuery.value : query.value.trim();
  if (!append) {
    query.value = term;
    activeSearchQuery.value = term;
  }
  if (!term) {
    activeSearchQuery.value = "";
    await loadHome();
    return;
  }

  const requestId = ++pageRequestId;
  if (append) loadingMore.value = true;
  else {
    loading.value = true;
    loadingMore.value = false;
  }
  error.value = "";
  page.value = "search";
  try {
    const nextVideos = await searchVideos(term, nextPage);
    if (requestId !== pageRequestId) return;
    videos.value = append ? mergeVideoList(videos.value, nextVideos) : nextVideos;
    if (scroll && !append) scrollToTop();
  } catch (err) {
    if (requestId !== pageRequestId) return;
    error.value = err instanceof Error ? err.message : String(err);
    notify("error", error.value);
  } finally {
    if (requestId === pageRequestId) {
      if (append) loadingMore.value = false;
      else loading.value = false;
    }
  }
}

async function loadDownloads() {
  const requestId = ++pageRequestId;
  loading.value = true;
  error.value = "";
  page.value = "downloads";
  try {
    const nextDownloads = await getDownloads();
    if (requestId !== pageRequestId) return;
    downloads.value = nextDownloads;
    scrollToTop();
  } catch (err) {
    if (requestId !== pageRequestId) return;
    error.value = err instanceof Error ? err.message : String(err);
    notify("error", error.value);
  } finally {
    if (requestId === pageRequestId) loading.value = false;
  }
}

function loadRecent() {
  pageRequestId++;
  loading.value = false;
  error.value = "";
  recentVideos.value = {
    videos: getRecentVideos(),
    currentPage: 1,
    totalPages: 1,
  };
  page.value = "recent";
  scrollToTop();
}

function refreshRecent() {
  loadRecent();
  notify("info", "最近观看已刷新", 1800);
}

function clearRecent() {
  clearRecentVideos();
  recentVideos.value = {
    videos: [],
    currentPage: 1,
    totalPages: 1,
  };
  notify("success", "最近观看已清空");
}

function removeRecent(video: VideoItem) {
  removeRecentVideo(video);
  recentVideos.value = {
    videos: getRecentVideos(),
    currentPage: 1,
    totalPages: 1,
  };
}

function showSources() {
  pageRequestId++;
  loading.value = false;
  error.value = "";
  page.value = "sources";
  scrollToTop();
}

function opensSeriesPanel(video: VideoItem): boolean {
  return video.contentType === "series";
}

function opensShortVideoPanel(video: VideoItem): boolean {
  return video.contentType === "infinite";
}

function nonEmptyText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function playableVideoOrNull(video: VideoItem): VideoItem | null {
  const url = httpUrlOrEmpty(video.url);
  const title = nonEmptyText(video.title);
  const source = nonEmptyText(video.source);
  if (!url || !title || !source) return null;
  return {
    ...video,
    id: nonEmptyText(video.id) || url,
    title,
    source,
    url,
    thumbnail: httpUrlOrEmpty(video.thumbnail),
  };
}

async function directDownload(video: VideoItem) {
  if (opensShortVideoPanel(video)) {
    selectedShortSeries.value = video;
    selectedSeries.value = null;
    selectedVideo.value = null;
    return;
  }
  if (opensSeriesPanel(video)) {
    selectedSeries.value = video;
    selectedVideo.value = null;
    selectedShortSeries.value = null;
    return;
  }
  const playableVideo = playableVideoOrNull(video);
  if (!playableVideo) {
    error.value = "无效的视频地址";
    notify("error", error.value);
    return;
  }
  if (downloadingItems.value.has(videoKey(playableVideo))) return;

  error.value = "";
  markItemDownloading(playableVideo, true);
  try {
    const urls = await parseVideo(playableVideo.url, playableVideo.source);
    const target = bestQuality(urls);
    if (!target) throw new Error("没有可下载地址");
    const task = await createDownload(
      playableVideo.title,
      target.url,
      target.referrer ?? playableVideo.url,
      target,
    );
    const started = await startDownload(task.id);
    if (!started.success) throw new Error("下载任务启动失败");
    downloads.value = await getDownloads();
    notify("success", `已加入下载队列：${playableVideo.title}`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    notify("error", error.value);
  } finally {
    markItemDownloading(playableVideo, false);
  }
}

function selectItem(video: VideoItem) {
  if (opensShortVideoPanel(video)) {
    selectedShortSeries.value = video;
    selectedSeries.value = null;
    selectedVideo.value = null;
    return;
  }

  if (opensSeriesPanel(video)) {
    selectedSeries.value = video;
    selectedVideo.value = null;
    selectedShortSeries.value = null;
    return;
  }

  const playableVideo = playableVideoOrNull(video);
  if (!playableVideo) {
    error.value = "无效的视频地址";
    notify("error", error.value);
    return;
  }

  selectedVideo.value = playableVideo;
  selectedSeries.value = null;
  selectedShortSeries.value = null;
}

function episodeAsVideo(episode: Episode, series: SeriesDetail): VideoItem | null {
  const url = httpUrlOrEmpty(episode.url);
  const source = nonEmptyText(series.source);
  if (!url || !source) return null;
  const title = nonEmptyText(episode.title) ||
    `第 ${episode.episodeNumber || 1} 集`;
  const seriesTitle = nonEmptyText(series.title) || "选集";
  return {
    id: `${episode.seriesId || series.seriesId}:${episode.id || url}:${url}`,
    title: `${seriesTitle} - ${title}`,
    thumbnail: httpUrlOrEmpty(episode.thumbnail) || httpUrlOrEmpty(series.thumbnail),
    url,
    source,
    contentType: "video",
  };
}

function playEpisode(episode: Episode, series: SeriesDetail) {
  const video = episodeAsVideo(episode, series);
  if (!video) {
    error.value = "无效的选集地址";
    notify("error", error.value);
    return;
  }
  selectedVideo.value = video;
}

async function downloadEpisode(episode: Episode, series: SeriesDetail) {
  const video = episodeAsVideo(episode, series);
  if (!video) {
    error.value = "无效的选集地址";
    notify("error", error.value);
    return;
  }
  await directDownload(video);
}

async function downloadEpisodes(episodes: Episode[], series: SeriesDetail) {
  if (seriesBatchDownloading.value) return;
  error.value = "";
  seriesBatchDownloading.value = true;
  let successCount = 0;
  const failures: string[] = [];
  try {
    for (const episode of episodes) {
      try {
        const video = episodeAsVideo(episode, series);
        if (!video) throw new Error("无效的选集地址");
        const urls = await parseVideo(video.url, video.source);
        const target = bestQuality(urls);
        if (!target) throw new Error("没有可下载地址");
        const task = await createDownload(
          video.title,
          target.url,
          target.referrer ?? video.url,
          target,
        );
        const started = await startDownload(task.id);
        if (!started.success) throw new Error("下载任务启动失败");
        successCount++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push(`${episode.title}: ${message}`);
      }
    }
    downloads.value = await getDownloads();
    if (failures.length) {
      error.value = `已添加 ${successCount} 个任务，${failures.length} 个失败：${
        failures.slice(0, 3).join("；")
      }`;
      notify("info", error.value, 5200);
    } else {
      notify("success", `已加入 ${successCount} 个下载任务`);
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    notify("error", error.value);
  } finally {
    seriesBatchDownloading.value = false;
  }
}

async function cancelTask(id: string) {
  error.value = "";
  try {
    const result = await cancelDownload(id);
    if (!result.success) throw new Error("取消下载任务失败");
    downloads.value = await getDownloads();
    notify("success", "已取消下载任务");
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    notify("error", error.value);
    await syncDownloads();
  }
}

async function retryTask(id: string) {
  error.value = "";
  try {
    const result = await retryDownload(id);
    if (!result.success) throw new Error("重新加入下载队列失败");
    downloads.value = await getDownloads();
    notify("success", "已重新加入下载队列");
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    notify("error", error.value);
    await syncDownloads();
  }
}

async function deleteTask(id: string, deleteFile: boolean) {
  error.value = "";
  try {
    const result = await deleteDownload(id, deleteFile);
    if (!result.success) throw new Error("删除下载任务失败");
    downloads.value = await getDownloads();
    notify("success", deleteFile ? "已删除任务和文件" : "已删除任务");
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    notify("error", error.value);
    await syncDownloads();
  }
}

async function clearCompleted() {
  error.value = "";
  try {
    const result = await clearCompletedDownloads();
    if (!result.success) throw new Error("清理已结束任务失败");
    downloads.value = await getDownloads();
    notify(
      result.clearedCount > 0 ? "success" : "info",
      result.clearedCount > 0
        ? `已清理 ${result.clearedCount} 个已结束任务`
        : "没有可清理的任务",
    );
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    notify("error", error.value);
    await syncDownloads();
  }
}

async function switchSource(sourceId: string) {
  const requestId = ++pageRequestId;
  loading.value = true;
  sourceActionId.value = sourceId;
  sourceActionKind.value = "switch";
  error.value = "";
  try {
    const result = await setActiveSource(sourceId);
    if (!result.success) throw new Error("切换视频源失败");
    activeSourceId.value = sourceId;
    selectedVideo.value = null;
    selectedSeries.value = null;
    selectedShortSeries.value = null;
    page.value = "home";
    const nextVideos = await getHomeVideos(1);
    if (requestId !== pageRequestId) return;
    videos.value = nextVideos;
    scrollToTop();
    notify("success", `已切换到 ${activeSource.value?.name ?? sourceId}`);
  } catch (err) {
    if (requestId !== pageRequestId) return;
    error.value = err instanceof Error ? err.message : String(err);
    notify("error", error.value);
  } finally {
    if (requestId === pageRequestId) {
      loading.value = false;
    }
    if (sourceActionId.value === sourceId && sourceActionKind.value === "switch") {
      sourceActionId.value = null;
      sourceActionKind.value = null;
    }
  }
}

async function reinitializeSource(sourceId: string) {
  const requestId = ++pageRequestId;
  loading.value = true;
  sourceActionId.value = sourceId;
  sourceActionKind.value = "reinit";
  error.value = "";
  try {
    const result = await reinitSource(sourceId);
    if (requestId !== pageRequestId) return;
    await loadSources().catch(() => null);
    if (requestId !== pageRequestId) return;
    if (!result.success) throw new Error("重初始化视频源失败");
    notify("success", "视频源已重初始化");
  } catch (err) {
    if (requestId !== pageRequestId) return;
    await loadSources().catch(() => null);
    if (requestId !== pageRequestId) return;
    error.value = err instanceof Error ? err.message : String(err);
    notify("error", error.value);
  } finally {
    if (requestId === pageRequestId) loading.value = false;
    if (sourceActionId.value === sourceId && sourceActionKind.value === "reinit") {
      sourceActionId.value = null;
      sourceActionKind.value = null;
    }
  }
}

async function syncSourceState() {
  try {
    const previous = activeSourceId.value;
    const [active, health] = await Promise.all([
      getActiveSource(),
      getSourceHealth().catch(() => null),
    ]);
    if (health) sourceHealth.value = health.health;
    const nextActiveId = chooseAvailableSourceId(
      sources.value,
      active.id,
      sourceHealth.value,
    );
    if (nextActiveId !== previous) {
      activeSourceId.value = nextActiveId;
      selectedVideo.value = null;
      selectedSeries.value = null;
      selectedShortSeries.value = null;
      const ownSwitchInFlight = sourceActionKind.value === "switch" &&
        sourceActionId.value === nextActiveId;
      if (nextActiveId && !ownSwitchInFlight) {
        if (page.value === "home") await loadHome(1, false);
        if (page.value === "search" && activeSearchQuery.value) {
          const draftQuery = query.value;
          query.value = activeSearchQuery.value;
          await runSearch(1, false);
          query.value = draftQuery;
        }
      }
    }
  } catch {
    // 后端不可用时保留当前视图状态。
  }
}

async function syncDownloads() {
  try {
    downloads.value = await getDownloads();
  } catch {
    // 网络或后端暂不可用时保留当前下载列表。
  }
}

function handlePlayerDownloaded() {
  syncDownloads();
  notify("success", "已创建下载任务");
}

function closeMedia() {
  selectedVideo.value = null;
  selectedSeries.value = null;
  selectedShortSeries.value = null;
}

async function openSearchOverlay() {
  searchOverlayOpen.value = true;
  await nextTick();
  overlaySearchInput.value?.focus();
  overlaySearchInput.value?.select();
}

function closeSearchOverlay() {
  searchOverlayOpen.value = false;
}

async function submitOverlaySearch() {
  closeSearchOverlay();
  await runSearch();
}

function handleScroll() {
  const scrollTop = Math.max(
    window.scrollY || 0,
    document.documentElement.scrollTop || 0,
    document.body.scrollTop || 0,
  );
  const nextScrolled = isScrolled.value
    ? scrollTop > scrolledExitThreshold
    : scrollTop > scrolledEnterThreshold;
  if (nextScrolled === isScrolled.value) return;
  isScrolled.value = nextScrolled;
  document.documentElement.dataset.scrolled = isScrolled.value ? "true" : "false";
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function loadMoreVideos() {
  if (loading.value || loadingMore.value || !canLoadMoreVideos.value) return;
  const nextPage = videos.value.currentPage + 1;
  if (page.value === "search") await runSearch(nextPage, false, true);
  else await loadHome(nextPage, false, true);
}

async function restorePagedList(targetPage: number, mode: "home" | "search") {
  const safeTarget = Math.max(1, Math.floor(targetPage || 1));
  if (mode === "search") await runSearch(1);
  else await loadHome(1);

  for (let nextPage = 2; nextPage <= safeTarget; nextPage++) {
    if (!canLoadMoreVideos.value) break;
    if (mode === "search") await runSearch(nextPage, false, true);
    else await loadHome(nextPage, false, true);
  }
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (globalThis.matchMedia?.("(max-width: 900px)").matches) {
      openSearchOverlay();
    } else {
      searchInput.value?.focus();
      searchInput.value?.select();
    }
    return;
  }

  if (event.key === "Escape") {
    if (searchOverlayOpen.value) {
      closeSearchOverlay();
      return;
    }
    if (captchaRequest.value) {
      const request = captchaRequest.value;
      captchaRequest.value = null;
      cancelCaptcha(request.requestId).catch(() => undefined);
      return;
    }
    if (selectedVideo.value) {
      closeMedia();
      return;
    }
    if (selectedSeries.value) {
      closeMedia();
      return;
    }
    if (selectedShortSeries.value) {
      closeMedia();
    }
  }
}

async function bootstrap() {
  loading.value = true;
  error.value = "";
  try {
    await loadSources();
    recentVideos.value = {
      videos: getRecentVideos(),
      currentPage: 1,
      totalPages: 1,
    };
    const route = readRouteState();
    if (route?.page === "search") {
      query.value = route.query;
      activeSearchQuery.value = route.query.trim();
      await restorePagedList(route.pageNum, "search");
    } else if (route?.page === "recent") {
      loadRecent();
    } else if (route?.page === "downloads") {
      await loadDownloads();
    } else if (route?.page === "sources") {
      page.value = "sources";
    } else {
      await restorePagedList(route?.page === "home" ? route.pageNum : 1, "home");
    }

    downloads.value = await getDownloads().catch(() => []);
    rpc.connect();
    setRpcClient(rpc);
    offDownloadUpdate = rpc.on<DownloadTask[]>("download:update", (tasks) => {
      downloads.value = normalizeDownloadTasks(tasks);
    });
    offDownloadComplete = rpc.on("download:complete", () => {
      notify("success", "下载任务已完成");
      syncDownloads();
    });
    offDownloadError = rpc.on("download:error", () => {
      notify("error", "下载任务失败");
      syncDownloads();
    });
    offCaptchaRequired = rpc.on<unknown>("captcha:required", (request) => {
      const normalized = normalizePushedCaptchaRequest(request);
      if (normalized) captchaRequest.value = normalized;
    });
    offCaptchaResolved = rpc.on("captcha:resolved", () => {
      captchaRequest.value = null;
    });
    offCaptchaCancelled = rpc.on("captcha:cancelled", () => {
      captchaRequest.value = null;
    });
    offSourceChange = rpc.on("source:change", () => {
      syncSourceState();
    });
    offSourceHealth = rpc.on<unknown>("source:health", (health) => {
      const normalized = normalizeSourceHealthMap(health);
      if (normalized) sourceHealth.value = normalized;
    });
    sourceSyncTimer = setInterval(syncSourceState, 30000);
    downloadPollTimer = setInterval(() => {
      if (!rpc.connected) syncDownloads();
    }, 2000);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    notify("error", error.value);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  initTheme();
  window.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("scroll", handleScroll, { passive: true });
  document.addEventListener("scroll", handleScroll, scrollListenerOptions);
  handleScroll();
  bootstrap();
});
onUnmounted(() => {
  offDownloadUpdate?.();
  offDownloadComplete?.();
  offDownloadError?.();
  offCaptchaRequired?.();
  offCaptchaResolved?.();
  offCaptchaCancelled?.();
  offSourceChange?.();
  offSourceHealth?.();
  if (sourceSyncTimer) clearInterval(sourceSyncTimer);
  if (downloadPollTimer) clearInterval(downloadPollTimer);
  for (const timer of toastTimers) window.clearTimeout(timer);
  toastTimers.clear();
  window.removeEventListener("keydown", handleGlobalKeydown);
  window.removeEventListener("scroll", handleScroll);
  document.removeEventListener("scroll", handleScroll, scrollListenerOptions);
  delete document.documentElement.dataset.scrolled;
  document.body.style.overflow = "";
  setRpcClient(null);
  rpc.disconnect();
});

watch(
  [mediaModalOpen, searchOverlayOpen, captchaRequest],
  ([modalOpen, overlayOpen, captcha]) => {
    document.body.style.overflow = modalOpen || overlayOpen || captcha
      ? "hidden"
      : "";
  },
);

watch(
  [page, activeSearchQuery, videos],
  () => {
    writeRouteState({
      page: page.value,
      query: activeSearchQuery.value,
      pageNum: page.value === "home" || page.value === "search"
        ? videos.value.currentPage
        : 1,
    });
  },
  { deep: true },
);
</script>

<template>
  <main class="shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"></span>
        <div>
          <strong>VDown</strong>
          <span>{{ activeSource?.name ?? "未选择源" }}</span>
        </div>
      </div>

      <nav class="nav" aria-label="主导航">
        <button type="button" :class="{ active: page === 'home' }" @click="loadHome()">
          <b><Home :size="18" :stroke-width="2.1" /></b>
          <span>首页</span>
        </button>
        <button type="button" :class="{ active: page === 'recent' }" @click="loadRecent">
          <b><Clock :size="18" :stroke-width="2.1" /></b>
          <span>最近</span>
        </button>
        <button
          type="button"
          :class="{ active: page === 'downloads' }"
          @click="loadDownloads()"
        >
          <b><Download :size="18" :stroke-width="2.1" /></b>
          <span>下载</span>
          <small v-if="activeDownloads">{{ activeDownloads }}</small>
        </button>
        <button type="button" :class="{ active: page === 'sources' }" @click="showSources">
          <b><CircleDot :size="18" :stroke-width="2.1" /></b>
          <span>视频源</span>
        </button>
      </nav>

      <button
        type="button"
        class="theme-toggle"
        :aria-label="theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'"
        @click="toggleTheme"
      >
        <b>
          <Sun v-if="theme === 'dark'" :size="18" :stroke-width="2.1" />
          <Moon v-else :size="18" :stroke-width="2.1" />
        </b>
        <span>{{ theme === "dark" ? "亮色" : "暗色" }}</span>
      </button>
    </aside>

    <section class="workspace">
      <header class="toolbar" :class="{ compact: isScrolled }">
        <div class="toolbar-title">
          <h1>
            {{
              page === "downloads"
                ? "下载任务"
                : page === "sources"
                  ? "视频源"
                  : page === "recent"
                    ? "最近观看"
                    : page === "search"
                      ? "搜索结果"
                      : "主页视频"
            }}
          </h1>
          <p>{{ pageSummary }}</p>
        </div>

        <form class="search desktop-search" @submit.prevent="runSearch()">
          <input
            ref="searchInput"
            v-model="query"
            type="search"
            placeholder="搜索视频"
            aria-label="搜索视频"
          />
          <button
            class="primary-button"
            type="submit"
            :disabled="loading"
            aria-label="搜索"
          >
            <Search :size="18" :stroke-width="2.2" />
          </button>
        </form>

        <button
          type="button"
          class="mobile-search-trigger"
          aria-label="搜索视频"
          @click="openSearchOverlay"
        >
          <span>搜索视频</span>
          <Search :size="18" :stroke-width="2.2" />
        </button>

        <div v-if="page !== 'downloads' && !mediaModalOpen" class="toolbar-actions">
          <button
            type="button"
            class="task-pill"
            :aria-label="taskActionLabel"
            :title="taskActionLabel"
            @click="loadDownloads"
          >
            <Download :size="14" :stroke-width="2.3" />
            <span class="task-pill-text">{{ taskActionLabel }}</span>
            <small v-if="activeDownloads">{{ activeDownloads }}</small>
          </button>
        </div>

      </header>

      <div
        v-if="searchOverlayOpen"
        class="mobile-search-overlay"
        @click.self="closeSearchOverlay"
      >
        <form class="search mobile-overlay-search" @submit.prevent="submitOverlaySearch">
          <input
            ref="overlaySearchInput"
            v-model="query"
            type="search"
            placeholder="搜索视频"
            aria-label="搜索视频"
          />
          <button
            class="primary-button"
            type="submit"
            :disabled="loading"
            aria-label="搜索"
          >
            <Search :size="18" :stroke-width="2.2" />
          </button>
          <button
            type="button"
            class="overlay-close"
            aria-label="关闭搜索"
            @click="closeSearchOverlay"
          >
            <X :size="18" :stroke-width="2.25" />
          </button>
        </form>
      </div>

      <section v-if="page === 'downloads'" class="panel">
        <DownloadsPanel
          :tasks="downloads"
          @refresh="loadDownloads"
          @cancel="cancelTask"
          @retry="retryTask"
          @delete="deleteTask"
          @clear="clearCompleted"
        />
      </section>

      <section v-else-if="page === 'sources'" class="panel sources-panel">
        <div v-if="sources.length === 0" class="empty">
          <i class="empty-mark"><CircleDot :size="21" :stroke-width="2.1" /></i>
          <strong>没有视频源</strong>
          <span>检查配置后重新启动服务</span>
        </div>
        <article
          v-for="source in sources"
          :key="source.id"
          class="source-row"
          :class="{ active: source.id === activeSourceId }"
        >
          <header class="source-row-head">
            <div>
              <strong>{{ source.name }}</strong>
              <small>{{ baseHost(source) }}</small>
            </div>
            <span :class="['source-status', sourceStatus(source)]">
              <i :class="['health-dot', sourceStatus(source)]"></i>
              <span :title="sourceStatusTitle(source)">
                {{ sourceStatusLabel(source) }}
              </span>
            </span>
          </header>
          <dl class="source-meta-list">
            <div>
              <dt>标识</dt>
              <dd>{{ source.id }}</dd>
            </div>
            <div>
              <dt>封面</dt>
              <dd>{{ source.imageAspectRatio || "16/9" }}</dd>
            </div>
          </dl>
          <div class="source-actions">
            <button
              class="primary-button"
              :class="{ 'current-source': source.id === activeSourceId }"
              type="button"
              :disabled="loading || !sourceAvailable(source) || source.id === activeSourceId"
              @click="switchSource(source.id)"
            >
              {{
                sourceActionId === source.id && sourceActionKind === "switch"
                  ? "切换中"
                  : source.id === activeSourceId
                    ? "当前"
                    : "切换"
              }}
            </button>
            <button
              type="button"
              :disabled="loading"
              @click="reinitializeSource(source.id)"
            >
              {{
                sourceActionId === source.id && sourceActionKind === "reinit"
                  ? "初始化中"
                  : "重初始化"
              }}
            </button>
          </div>
        </article>
      </section>

      <template v-else>
        <section v-if="page === 'recent'" class="recent-tools">
          <div>
            <strong>继续观看</strong>
            <span>本地保存 30 天，播完的视频会自动隐藏</span>
          </div>
          <div class="panel-actions">
            <button type="button" @click="refreshRecent">
              <RefreshCw :size="14" :stroke-width="2.3" />
              刷新
            </button>
            <button
              type="button"
              :disabled="recentVideos.videos.length === 0"
              @click="clearRecent"
            >
              <Trash2 :size="14" :stroke-width="2.3" />
              清空
            </button>
          </div>
        </section>

        <VideoGrid
          :items="page === 'recent' ? recentVideos.videos : videos.videos"
          :progress="page === 'recent' ? recentProgress : undefined"
          :loading="loading"
          :loading-more="loadingMore"
          :current-page="page === 'recent' ? recentVideos.currentPage : videos.currentPage"
          :total-pages="page === 'recent' ? recentVideos.totalPages : videos.totalPages"
          :source-aspect-ratios="sourceAspectRatios"
          :source-image-proxy-ids="sourceImageProxyIds"
          :busy-items="downloadingItemMap"
          :default-aspect-ratio="activeImageAspectRatio"
          :empty-title="videoEmptyTitle"
          :empty-text="videoEmptyText"
          :removable="page === 'recent'"
          @load-more="loadMoreVideos"
          @select="selectItem"
          @download="directDownload"
          @remove="removeRecent"
        />
      </template>
    </section>

    <div
      v-if="mediaModalOpen"
      class="media-modal-backdrop"
      @click.self="closeMedia"
    >
      <ShortVideoPanel
        v-if="selectedShortSeries"
        :series="selectedShortSeries"
        @close="selectedShortSeries = null"
        @downloaded="handlePlayerDownloaded"
      />

      <SeriesPanel
        v-else-if="selectedSeries && !selectedVideo"
        :series="selectedSeries"
        :downloading-many="seriesBatchDownloading"
        @close="selectedSeries = null"
        @play="playEpisode"
        @download="downloadEpisode"
        @download-many="downloadEpisodes"
      />

      <PlayerPanel
        v-else
        :video="selectedVideo"
        @close="selectedVideo = null"
        @downloaded="handlePlayerDownloaded"
      />
    </div>

    <div
      v-if="!mediaModalOpen && !captchaRequest && (isScrolled || canLoadMoreVideos)"
      class="quick-nav"
      aria-label="快速导航"
    >
      <button
        type="button"
        :disabled="!isScrolled"
        aria-label="回到顶部"
        title="回到顶部"
        @click="scrollToTop"
      >
        <ArrowUp :size="18" :stroke-width="2.3" />
      </button>
      <button
        type="button"
        :disabled="loading || loadingMore || !canLoadMoreVideos"
        aria-label="加载更多"
        title="加载更多"
        @click="loadMoreVideos"
      >
        <LoaderCircle
          v-if="loadingMore"
          class="spin-icon"
          :size="18"
          :stroke-width="2.3"
        />
        <ArrowDown v-else :size="18" :stroke-width="2.3" />
      </button>
    </div>

    <CaptchaDialog
      :request="captchaRequest"
      @close="captchaRequest = null"
    />

    <ToastViewport :items="toasts" />
  </main>
</template>
