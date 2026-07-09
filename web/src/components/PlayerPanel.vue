<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from "vue";
import { Check, Copy, Download, LoaderCircle, X } from "@lucide/vue";
import { useVideoPlayback } from "../composables/useVideoPlayback";
import type { VideoItem } from "../types/api";
import ArtVideoPlayer from "./ArtVideoPlayer.vue";

const props = defineProps<{
  video: VideoItem | null;
}>();

const emit = defineEmits<{
  close: [];
  downloaded: [];
}>();

const panel = ref<HTMLElement | null>(null);
const playback = useVideoPlayback(toRef(props, "video"), {
  onDownloaded: () => emit("downloaded"),
});
const {
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
} = playback;

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
    clearError();
  },
);

onMounted(() => {
  void nextTick(() => panel.value?.focus());
});

onBeforeUnmount(() => {
  cleanup();
});
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
          @error="setError"
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
        <button type="button" @click="retry">重试</button>
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
