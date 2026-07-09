<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  LoaderCircle,
  RefreshCw,
  X,
} from "@lucide/vue";
import { getSeriesVideos } from "../api/client";
import { useVideoPlayback } from "../composables/useVideoPlayback";
import { httpUrlOrEmpty } from "../utils/media";
import type { Episode, VideoItem } from "../types/api";
import ArtVideoPlayer from "./ArtVideoPlayer.vue";

const props = defineProps<{
  series: VideoItem | null;
}>();

const emit = defineEmits<{
  close: [];
  downloaded: [];
}>();

const panel = ref<HTMLElement | null>(null);
const shortFeed = ref<HTMLElement | null>(null);
const feedEnd = ref<HTMLElement | null>(null);
const episodes = ref<Episode[]>([]);
const currentIndex = ref(0);
const loading = ref(false);
const loadingMore = ref(false);
const autoNext = ref(true);
const error = ref("");
const page = ref(0);
const hasMore = ref(true);
let seriesRequestId = 0;
let feedObserver: IntersectionObserver | null = null;
let touchStartY: number | null = null;
let loadingMorePromise: Promise<number> | null = null;

const currentEpisode = computed(() => episodes.value[currentIndex.value] ?? null);
const currentVideo = computed<VideoItem | null>(() => {
  const episode = currentEpisode.value;
  const series = props.series;
  if (!episode || !series) return null;
  const url = httpUrlOrEmpty(episode.url);
  if (!url) return null;
  const title = episode.title || `短视频 ${episode.episodeNumber || currentIndex.value + 1}`;
  return {
    id: `${episode.seriesId || series.id}:${episode.id || url}:${url}`,
    title,
    thumbnail: httpUrlOrEmpty(episode.thumbnail) || httpUrlOrEmpty(series.thumbnail),
    url,
    source: series.source,
    contentType: "video",
  };
});
const playback = useVideoPlayback(currentVideo, {
  progressIntervalMs: 2500,
  progressNearEndSeconds: 8,
  onDownloaded: () => emit("downloaded"),
});
const {
  loading: parsing,
  downloading,
  copied,
  error: playbackError,
  selected,
  src,
  poster,
  canPlay,
  loadVideo,
  retry,
  downloadSelected,
  copySelectedLink,
  handleProgress,
  setError: setPlaybackError,
  clearError: clearPlaybackError,
  cleanup: cleanupPlayback,
} = playback;
const visibleError = computed(() => error.value || playbackError.value);

async function loadShortVideos(series: VideoItem | null, nextPage = 1): Promise<number> {
  const requestId = ++seriesRequestId;
  if (nextPage === 1) {
    loadingMorePromise = null;
    episodes.value = [];
    currentIndex.value = 0;
    page.value = 0;
    hasMore.value = true;
  }
  error.value = "";
  if (!series || !hasMore.value && nextPage !== 1) return 0;

  if (nextPage === 1) loading.value = true;
  else loadingMore.value = true;
  try {
    const result = await getSeriesVideos(series.id, series.source, nextPage);
    if (requestId !== seriesRequestId) return 0;
    const existing = new Set(episodes.value.map((episode) => episodeKey(episode)));
    const appended = result.episodes.filter((episode) => {
      const key = episodeKey(episode);
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    });
    episodes.value = nextPage === 1 ? result.episodes : [...episodes.value, ...appended];
    page.value = nextPage;
    hasMore.value = result.episodes.length > 0 && appended.length > 0;
    if (!episodes.value.length) error.value = "没有短视频";
    return nextPage === 1 ? result.episodes.length : appended.length;
  } catch (err) {
    if (requestId !== seriesRequestId) return 0;
    error.value = err instanceof Error ? err.message : String(err);
    return 0;
  } finally {
    if (requestId === seriesRequestId) {
      loading.value = false;
      loadingMore.value = false;
    }
  }
}

function retryVisibleError() {
  if (error.value) {
    void loadShortVideos(props.series, episodes.value.length ? page.value + 1 : 1);
    return;
  }
  retry();
}

function episodeKey(episode: Episode): string {
  return `${episode.id}:${episode.url}`;
}

function move(step: number): boolean {
  if (!episodes.value.length) return false;
  const nextIndex = Math.min(
    Math.max(currentIndex.value + step, 0),
    episodes.value.length - 1,
  );
  if (nextIndex === currentIndex.value) return false;
  currentIndex.value = nextIndex;
  if (step > 0 && hasMore.value && nextIndex >= episodes.value.length - 3) {
    void loadMoreShortVideos();
  }
  return true;
}

function selectEpisode(index: number) {
  currentIndex.value = index;
  if (hasMore.value && index >= episodes.value.length - 3) {
    void loadMoreShortVideos();
  }
}

async function loadMoreShortVideos(): Promise<number> {
  if (!props.series || loading.value || !hasMore.value) return 0;
  if (loadingMorePromise) return await loadingMorePromise;
  const promise = loadShortVideos(props.series, page.value + 1);
  loadingMorePromise = promise;
  try {
    return await promise;
  } finally {
    if (loadingMorePromise === promise) loadingMorePromise = null;
  }
}

async function goNext() {
  if (move(1)) return;
  if (hasMore.value && await loadMoreShortVideos() > 0) {
    move(1);
  }
}

async function handleEnded() {
  if (!autoNext.value) return;
  await goNext();
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    void goNext();
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    move(-1);
  }
}

function handleWheel(event: WheelEvent) {
  if (Math.abs(event.deltaY) < 32) return;
  event.preventDefault();
  if (event.deltaY > 0) void goNext();
  else move(-1);
}

function handleTouchStart(event: TouchEvent) {
  touchStartY = event.touches[0]?.clientY ?? null;
}

function handleTouchEnd(event: TouchEvent) {
  if (touchStartY == null) return;
  const endY = event.changedTouches[0]?.clientY ?? touchStartY;
  const delta = touchStartY - endY;
  touchStartY = null;
  if (Math.abs(delta) < 42) return;
  if (delta > 0) void goNext();
  else move(-1);
}

function setupFeedObserver() {
  feedObserver?.disconnect();
  if (!feedEnd.value || typeof IntersectionObserver === "undefined") return;
  feedObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMoreShortVideos();
    },
    { root: shortFeed.value, rootMargin: "220px 0px" },
  );
  feedObserver.observe(feedEnd.value);
}

watch(
  () => props.series,
  (series) => {
    loadingMorePromise = null;
    void loadShortVideos(series);
    void nextTick(() => panel.value?.focus());
  },
  { immediate: true },
);

watch(
  () => currentVideo.value?.url,
  () => {
    clearPlaybackError();
    void loadVideo();
  },
);

watch(feedEnd, setupFeedObserver);

onMounted(() => {
  void nextTick(() => panel.value?.focus());
  setupFeedObserver();
});

onBeforeUnmount(() => {
  seriesRequestId++;
  loadingMorePromise = null;
  feedObserver?.disconnect();
  cleanupPlayback();
});
</script>

<template>
  <aside
    v-if="series"
    ref="panel"
    class="short-panel"
    role="dialog"
    aria-modal="true"
    aria-labelledby="short-title"
    tabindex="-1"
    @keydown="handleKeydown"
  >
    <header class="short-topbar">
      <div>
        <span>{{ series.source }}</span>
        <h2 id="short-title">短视频</h2>
      </div>
      <button type="button" class="icon-button" aria-label="关闭" @click="emit('close')">
        <X :size="18" :stroke-width="2.2" />
      </button>
    </header>

    <section
      class="short-stage"
    >
      <div
        class="short-player"
        @wheel="handleWheel"
        @touchstart.passive="handleTouchStart"
        @touchend="handleTouchEnd"
      >
        <ArtVideoPlayer
          v-if="canPlay"
          :src="src"
          :title="currentVideo?.title || '短视频'"
          :format="selected?.format"
          :poster="poster"
          @error="setPlaybackError"
          @progress="handleProgress"
          @ended="handleEnded"
        />
        <div v-else class="player-loading" role="status">
          <img
            v-if="poster"
            class="player-loading-poster"
            :src="poster"
            alt=""
            draggable="false"
          />
          <div class="player-loading-content">
            <LoaderCircle
              v-if="loading || parsing"
              class="spin-icon"
              :size="24"
              :stroke-width="2.2"
            />
            <strong>{{ loading ? "加载短视频" : parsing ? "解析播放地址" : "等待短视频" }}</strong>
            <span>{{ currentVideo?.title || "短视频列表准备中" }}</span>
          </div>
        </div>

        <div class="short-nav" aria-label="短视频切换">
          <button
            type="button"
            :disabled="currentIndex <= 0"
            aria-label="上一条短视频"
            @click="move(-1)"
          >
            <ChevronUp :size="20" :stroke-width="2.3" />
          </button>
          <button
            type="button"
            :disabled="currentIndex >= episodes.length - 1 && !hasMore"
            aria-label="下一条短视频"
            @click="goNext"
          >
            <ChevronDown :size="20" :stroke-width="2.3" />
          </button>
        </div>
      </div>

      <aside class="short-side" aria-label="短视频列表">
        <div class="short-current">
          <span>{{ episodes.length ? `${currentIndex + 1} / ${episodes.length}` : "0 / 0" }}</span>
          <strong>{{ currentVideo?.title || series.title }}</strong>
          <div class="short-actions">
            <button
              type="button"
              :disabled="currentIndex <= 0"
              @click="move(-1)"
            >
              <ChevronUp :size="15" :stroke-width="2.3" />
              上一条
            </button>
            <button
              type="button"
              :disabled="currentIndex >= episodes.length - 1 && !hasMore"
              @click="goNext"
            >
              <ChevronDown :size="15" :stroke-width="2.3" />
              下一条
            </button>
            <button
              type="button"
              :class="{ active: autoNext }"
              :aria-pressed="autoNext"
              @click="autoNext = !autoNext"
            >
              连播
            </button>
            <button type="button" @click="retry">
              <RefreshCw :size="15" :stroke-width="2.3" />
              重试
            </button>
            <button
              type="button"
              :disabled="!canPlay"
              @click="copySelectedLink"
            >
              <Check v-if="copied" :size="15" :stroke-width="2.3" />
              <Copy v-else :size="15" :stroke-width="2.3" />
              {{ copied ? "已复制" : "复制链接" }}
            </button>
            <button
              type="button"
              :disabled="!canPlay || downloading"
              @click="downloadSelected"
            >
              <LoaderCircle
                v-if="downloading"
                class="spin-icon"
                :size="15"
                :stroke-width="2.3"
              />
              <Download v-else :size="15" :stroke-width="2.3" />
              {{ downloading ? "创建中" : "下载" }}
            </button>
          </div>
        </div>

        <div v-if="visibleError" class="short-error state-error">
          <span role="alert">{{ visibleError }}</span>
          <button type="button" @click="retryVisibleError">重试</button>
        </div>

        <div ref="shortFeed" class="short-feed">
          <button
            v-for="(episode, index) in episodes"
            :key="`${episode.id}:${episode.url}`"
            type="button"
            :class="{ active: index === currentIndex }"
            @click="selectEpisode(index)"
          >
            <span>{{ index + 1 }}</span>
            <strong>{{ episode.title || `短视频 ${index + 1}` }}</strong>
          </button>
          <button
            v-if="hasMore"
            ref="feedEnd"
            type="button"
            class="short-load-more"
            :disabled="loadingMore"
            @click="loadMoreShortVideos"
          >
            <LoaderCircle
              v-if="loadingMore"
              class="spin-icon"
              :size="15"
              :stroke-width="2.3"
            />
            {{ loadingMore ? "加载中" : "继续加载" }}
          </button>
        </div>
      </aside>
    </section>
  </aside>
</template>
