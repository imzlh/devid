<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Check, Copy, Download, X } from "@lucide/vue";
import { createDownload, parseVideo, startDownload } from "../api/client";
import { bestQuality, playbackUrl } from "../utils/media";
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
const downloading = ref(false);
const copied = ref(false);
const error = ref("");
const qualities = ref<VideoUrl[]>([]);
const selected = ref<VideoUrl | null>(null);
let parseRequestId = 0;
let lastProgressSave = 0;

const src = computed(() =>
  selected.value && props.video ? playbackUrl(selected.value, props.video.url) : ""
);
const resumeTime = computed(() => props.video ? getProgress(props.video) : 0);

watch(
  () => props.video,
  async (video) => {
    const requestId = ++parseRequestId;
    qualities.value = [];
    selected.value = null;
    error.value = "";
    copied.value = false;
    lastProgressSave = 0;
    if (!video) return;

    loading.value = true;
    try {
      const results = await parseVideo(video.url, video.source);
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
      if (requestId === parseRequestId) loading.value = false;
    }
  },
  { immediate: true },
);

async function downloadSelected() {
  if (!props.video || !selected.value) return;
  downloading.value = true;
  error.value = "";
  try {
    const task = await createDownload(
      props.video.title,
      selected.value.url,
      props.video.url,
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
  try {
    const link = new URL(src.value, window.location.origin).href;
    await navigator.clipboard.writeText(link);
    copied.value = true;
    window.setTimeout(() => {
      copied.value = false;
    }, 1400);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "复制失败";
  }
}

function handleProgress(time: number, duration: number) {
  if (!props.video) return;
  const now = Date.now();
  if (now - lastProgressSave < 4000 && time < duration - 20) return;
  lastProgressSave = now;
  saveProgress(props.video, time, duration);
}
</script>

<template>
  <aside v-if="video" class="player-panel">
    <header class="player-header">
      <div>
        <h2>{{ video.title }}</h2>
        <span>{{ video.source }}</span>
      </div>
      <button type="button" class="icon-button" aria-label="关闭" @click="emit('close')">
        <X :size="18" :stroke-width="2.2" />
      </button>
    </header>

    <div class="player-surface">
      <ArtVideoPlayer
        v-if="src"
        :src="src"
        :title="video.title"
        :poster="video.thumbnail"
        :start-time="resumeTime"
        @error="error = $event"
        @progress="handleProgress"
      />
      <div v-else class="empty">
        {{ loading ? "解析播放地址..." : "等待播放地址" }}
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <section v-if="qualities.length > 0" class="player-section">
      <span>清晰度</span>
      <div class="quality-row">
        <button
          v-for="quality in qualities"
          :key="quality.url"
          :class="{ active: quality.url === selected?.url }"
          @click="selected = quality"
        >
          {{ quality.quality || quality.resolution || "默认" }}
        </button>
      </div>
    </section>

    <p v-if="resumeTime > 0" class="resume-hint">
      已从 {{ Math.floor(resumeTime / 60) }}:{{ String(Math.floor(resumeTime % 60)).padStart(2, "0") }} 继续播放
    </p>

    <footer class="player-actions">
      <button
        type="button"
        :disabled="!selected || downloading"
        @click="downloadSelected"
      >
        <Download :size="15" :stroke-width="2.3" />
        {{ downloading ? "创建中..." : "下载当前清晰度" }}
      </button>
      <button
        type="button"
        :disabled="!src"
        @click="copySelectedLink"
      >
        <Check v-if="copied" :size="15" :stroke-width="2.3" />
        <Copy v-else :size="15" :stroke-width="2.3" />
        {{ copied ? "已复制" : "复制链接" }}
      </button>
    </footer>
  </aside>
</template>
