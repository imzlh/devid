import { computed, type Ref, ref } from "vue";
import { createDownload, parseVideo, startDownload } from "../api/client";
import {
  bestQuality,
  httpUrlOrEmpty,
  normalizePlaybackUrls,
  playbackUrl,
} from "../utils/media";
import { getProgress, saveProgress } from "../utils/progress";
import type { VideoItem, VideoUrl } from "../types/api";

interface UseVideoPlaybackOptions {
  progressIntervalMs?: number;
  progressNearEndSeconds?: number;
  slowLoadingMs?: number;
  onDownloaded?: () => void;
}

export function useVideoPlayback(
  video: Readonly<Ref<VideoItem | null>>,
  options: UseVideoPlaybackOptions = {},
) {
  const loading = ref(false);
  const slowLoading = ref(false);
  const downloading = ref(false);
  const copied = ref(false);
  const error = ref("");
  const qualities = ref<VideoUrl[]>([]);
  const selected = ref<VideoUrl | null>(null);
  let requestId = 0;
  let lastProgressSave = 0;
  let slowLoadingTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let copyResetTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  const src = computed(() =>
    selected.value && video.value
      ? playbackUrl(selected.value, video.value.url)
      : ""
  );
  const poster = computed(() => httpUrlOrEmpty(video.value?.thumbnail));
  const resumeTime = computed(() => video.value ? getProgress(video.value) : 0);
  const canPlay = computed(() =>
    Boolean(video.value && selected.value && src.value)
  );

  function clearSlowLoadingTimer() {
    if (slowLoadingTimer) globalThis.clearTimeout(slowLoadingTimer);
    slowLoadingTimer = null;
  }

  function resetTransientState() {
    clearSlowLoadingTimer();
    qualities.value = [];
    selected.value = null;
    error.value = "";
    copied.value = false;
    slowLoading.value = false;
    lastProgressSave = 0;
  }

  async function loadVideo(nextVideo = video.value) {
    const currentRequestId = ++requestId;
    resetTransientState();
    if (!nextVideo) return;

    loading.value = true;
    const slowLoadingMs = options.slowLoadingMs ?? 15000;
    if (slowLoadingMs > 0) {
      slowLoadingTimer = globalThis.setTimeout(() => {
        if (currentRequestId === requestId && loading.value) {
          slowLoading.value = true;
        }
      }, slowLoadingMs);
    }

    try {
      const results = normalizePlaybackUrls(
        await parseVideo(nextVideo.url, nextVideo.source),
      );
      if (currentRequestId !== requestId) return;
      qualities.value = results;
      selected.value = bestQuality(results);
      if (!results.length) error.value = "没有可播放地址";
    } catch (err) {
      if (currentRequestId !== requestId) return;
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      if (currentRequestId === requestId) {
        loading.value = false;
        clearSlowLoadingTimer();
      }
    }
  }

  function retry() {
    void loadVideo();
  }

  async function downloadSelected() {
    const currentVideo = video.value;
    if (!currentVideo || !selected.value || downloading.value) return;

    downloading.value = true;
    error.value = "";
    try {
      const task = await createDownload(
        currentVideo.title,
        selected.value.url,
        selected.value.referrer ?? currentVideo.url,
        selected.value,
      );
      const started = await startDownload(task.id);
      if (!started.success) throw new Error("下载任务启动失败");
      options.onDownloaded?.();
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      downloading.value = false;
    }
  }

  async function copySelectedLink() {
    if (!src.value) return;
    error.value = "";
    copied.value = false;
    if (copyResetTimer) globalThis.clearTimeout(copyResetTimer);
    try {
      const link = new URL(src.value, globalThis.location.origin).href;
      await navigator.clipboard.writeText(link);
      copied.value = true;
      copyResetTimer = globalThis.setTimeout(() => {
        copied.value = false;
        copyResetTimer = null;
      }, 1400);
    } catch (err) {
      error.value = err instanceof Error ? err.message : "复制失败";
    }
  }

  function handleProgress(time: number, duration: number) {
    const currentVideo = video.value;
    if (
      !currentVideo ||
      !Number.isFinite(time) ||
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      return;
    }
    const now = Date.now();
    const intervalMs = options.progressIntervalMs ?? 4000;
    const nearEndSeconds = options.progressNearEndSeconds ?? 20;
    if (
      now - lastProgressSave < intervalMs && time < duration - nearEndSeconds
    ) {
      return;
    }
    lastProgressSave = now;
    saveProgress(currentVideo, time, duration);
  }

  function setError(message: string) {
    error.value = message;
  }

  function clearError() {
    error.value = "";
  }

  function cleanup() {
    requestId++;
    clearSlowLoadingTimer();
    if (copyResetTimer) globalThis.clearTimeout(copyResetTimer);
    copyResetTimer = null;
  }

  return {
    loading,
    slowLoading,
    downloading,
    copied,
    error,
    qualities,
    selected,
    src,
    poster,
    resumeTime,
    canPlay,
    loadVideo,
    retry,
    downloadSelected,
    copySelectedLink,
    handleProgress,
    setError,
    clearError,
    cleanup,
  };
}
