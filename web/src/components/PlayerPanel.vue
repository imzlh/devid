<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Check, Copy, Download, LoaderCircle, X } from "@lucide/vue";
import { createDownload, parseVideo, startDownload } from "../api/client";
import {
  bestQuality,
  httpUrlOrEmpty,
  normalizePlaybackUrls,
  playbackUrl,
} from "../utils/media";
import { getProgress, saveProgress } from "../utils/progress";
import type { VideoItem, VideoUrl } from "../types/api";
import ArtVideoPlayer from "./ArtVideoPlayer.vue";

const props = defineProps<{
  video: VideoItem | null;
}>();

const emit = defineEmits<{
  close: [];
  downloaded: [];
}>();

const loading = ref(false);
const slowLoading = ref(false);
const downloading = ref(false);
const copied = ref(false);
const error = ref("");
const qualities = ref<VideoUrl[]>([]);
const selected = ref<VideoUrl | null>(null);
const panel = ref<HTMLElement | null>(null);
let parseRequestId = 0;
let lastProgressSave = 0;
let slowLoadingTimer: ReturnType<typeof window.setTimeout> | null = null;
let copyResetTimer: ReturnType<typeof window.setTimeout> | null = null;

const src = computed(() =>
  selected.value && props.video ? playbackUrl(selected.value, props.video.url) : ""
);
const poster = computed(() => httpUrlOrEmpty(props.video?.thumbnail));
const resumeTime = computed(() => props.video ? getProgress(props.video) : 0);
const canPlay = computed(() => Boolean(selected.value && src.value));

async function loadVideo(video: VideoItem | null) {
  const requestId = ++parseRequestId;
  if (slowLoadingTimer) window.clearTimeout(slowLoadingTimer);
  qualities.value = [];
  selected.value = null;
  error.value = "";
  copied.value = false;
  slowLoading.value = false;
  lastProgressSave = 0;
  if (!video) return;

  loading.value = true;
  slowLoadingTimer = window.setTimeout(() => {
    if (requestId === parseRequestId && loading.value) slowLoading.value = true;
  }, 15000);
  try {
    const results = normalizePlaybackUrls(await parseVideo(video.url, video.source));
    if (requestId !== parseRequestId) return;
    qualities.value = results;
    selected.value = bestQuality(results);
    if (!results.length) {
      error.value = "没有可播放地址";
    }
  } catch (err) {
    if (requestId !== parseRequestId) return;
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    if (requestId === parseRequestId) {
      loading.value = false;
      if (slowLoadingTimer) window.clearTimeout(slowLoadingTimer);
      slowLoadingTimer = null;
    }
  }
}

function retryLoadVideo() {
  if (props.video) void loadVideo(props.video);
}

watch(
  () => props.video,
  (video) => {
    void loadVideo(video);
    void nextTick(() => panel.value?.focus());
  },
  { immediate: true },
);

watch(
  () => selected.value?.url,
  () => {
    error.value = "";
  },
);

onMounted(() => {
  void nextTick(() => panel.value?.focus());
});

onBeforeUnmount(() => {
  parseRequestId++;
  if (slowLoadingTimer) window.clearTimeout(slowLoadingTimer);
  if (copyResetTimer) window.clearTimeout(copyResetTimer);
});

async function downloadSelected() {
  if (!props.video || !selected.value) return;
  downloading.value = true;
  error.value = "";
  try {
    const task = await createDownload(
      props.video.title,
      selected.value.url,
      selected.value.referrer ?? props.video.url,
      selected.value,
    );
    const started = await startDownload(task.id);
    if (!started.success) throw new Error("下载任务启动失败");
    emit("downloaded");
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
  if (copyResetTimer) window.clearTimeout(copyResetTimer);
  try {
    const link = new URL(src.value, window.location.origin).href;
    await navigator.clipboard.writeText(link);
    copied.value = true;
    copyResetTimer = window.setTimeout(() => {
      copied.value = false;
      copyResetTimer = null;
    }, 1400);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "复制失败";
  }
}

function handleProgress(time: number, duration: number) {
  if (!props.video) return;
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) {
    return;
  }
  const now = Date.now();
  if (now - lastProgressSave < 4000 && time < duration - 20) return;
  lastProgressSave = now;
  saveProgress(props.video, time, duration);
}
</script>

<template>
  <aside
    v-if="video"
    ref="panel"
    class="player-panel"
    role="dialog"
    aria-modal="true"
    aria-labelledby="player-title"
    tabindex="-1"
  >
    <header class="player-topbar">
      <div class="player-title">
        <span>{{ video.source }}</span>
        <h2 id="player-title">{{ video.title }}</h2>
        <p v-if="resumeTime > 0">
          已从 {{ Math.floor(resumeTime / 60) }}:{{ String(Math.floor(resumeTime % 60)).padStart(2, "0") }} 继续播放
        </p>
      </div>
      <button type="button" class="icon-button" aria-label="关闭" @click="emit('close')">
        <X :size="18" :stroke-width="2.2" />
      </button>
    </header>

    <section class="player-stage">
      <div class="player-surface">
        <ArtVideoPlayer
          v-if="canPlay"
          :src="src"
          :title="video.title"
          :format="selected?.format"
          :poster="poster"
          :start-time="resumeTime"
          @error="error = $event"
          @progress="handleProgress"
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
              v-if="loading"
              class="spin-icon"
              :size="24"
              :stroke-width="2.2"
            />
            <strong>{{ loading ? "解析播放地址" : "等待播放地址" }}</strong>
            <span>{{ loading ? "正在准备播放器" : "选择可用清晰度后开始播放" }}</span>
            <small v-if="slowLoading">解析时间偏长，可以继续等待或稍后重试</small>
          </div>
        </div>
      </div>

      <div v-if="error" class="player-error state-error">
        <span role="alert">{{ error }}</span>
        <button type="button" @click="retryLoadVideo">重试</button>
      </div>
    </section>

    <footer class="player-dock">
      <section v-if="qualities.length > 0" class="player-quality">
        <span>清晰度</span>
        <div class="quality-row">
          <button
            v-for="quality in qualities"
            :key="quality.url"
            type="button"
            :class="{ active: quality.url === selected?.url }"
            @click="selected = quality"
          >
            {{ quality.quality || quality.resolution || "默认" }}
          </button>
        </div>
      </section>

      <div class="player-actions">
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
        <button
          type="button"
          :disabled="!canPlay"
          @click="copySelectedLink"
        >
          <Check v-if="copied" :size="15" :stroke-width="2.3" />
          <Copy v-else :size="15" :stroke-width="2.3" />
          {{ copied ? "已复制" : "复制链接" }}
        </button>
      </div>
    </footer>
  </aside>
</template>
