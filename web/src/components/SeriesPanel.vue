<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Download, Play, X } from "@lucide/vue";
import { getSeriesDetail, getSeriesVideos } from "../api/client";
import type { Episode, SeriesDetail, VideoItem } from "../types/api";

const props = defineProps<{
  series: VideoItem | null;
  downloadingMany?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  play: [episode: Episode, series: SeriesDetail];
  download: [episode: Episode, series: SeriesDetail];
  downloadMany: [episodes: Episode[], series: SeriesDetail];
}>();

const detail = ref<SeriesDetail | null>(null);
const loading = ref(false);
const error = ref("");
const selectedIds = ref<Set<string>>(new Set());
let detailRequestId = 0;

const episodes = computed(() => detail.value?.episodes ?? []);
const selectedEpisodes = computed(() =>
  episodes.value.filter((episode) => selectedIds.value.has(episodeKey(episode)))
);
const allEpisodesSelected = computed(() =>
  episodes.value.length > 0 && selectedIds.value.size === episodes.value.length
);

function episodeKey(episode: Episode): string {
  return `${episode.id}:${episode.url}`;
}

function detailFromInfinite(series: VideoItem, episodes: Episode[]): SeriesDetail {
  return {
    id: series.id,
    seriesId: series.id,
    title: series.title,
    thumbnail: series.thumbnail,
    totalEpisodes: episodes.length,
    source: series.source,
    url: series.url,
    episodes,
  };
}

watch(
  () => props.series,
  async (series) => {
    const requestId = ++detailRequestId;
    detail.value = null;
    selectedIds.value = new Set();
    error.value = "";
    if (!series) return;

    loading.value = true;
    try {
      const nextDetail = series.contentType === "infinite"
        ? detailFromInfinite(
          series,
          (await getSeriesVideos(series.id, series.source)).episodes,
        )
        : await getSeriesDetail(
          series.id,
          series.url,
          series.source,
        );
      if (requestId !== detailRequestId) return;
      detail.value = nextDetail;
    } catch (err) {
      if (requestId !== detailRequestId) return;
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      if (requestId === detailRequestId) loading.value = false;
    }
  },
  { immediate: true },
);

function toggleEpisode(episode: Episode, checked: boolean) {
  const next = new Set(selectedIds.value);
  const key = episodeKey(episode);
  if (checked) next.add(key);
  else next.delete(key);
  selectedIds.value = next;
}

function toggleAll() {
  if (allEpisodesSelected.value) {
    selectedIds.value = new Set();
    return;
  }
  selectedIds.value = new Set(episodes.value.map(episodeKey));
}

function downloadSelected() {
  if (!detail.value || selectedEpisodes.value.length === 0) return;
  emit("downloadMany", selectedEpisodes.value, detail.value);
}
</script>

<template>
  <aside v-if="series" class="series-panel">
    <header class="player-header">
      <div>
        <h2>{{ detail?.title ?? series.title }}</h2>
        <span>{{ detail?.totalEpisodes ?? 0 }} 集 · {{ series.source }}</span>
      </div>
      <button type="button" class="icon-button" aria-label="关闭" @click="emit('close')">
        <X :size="18" :stroke-width="2.2" />
      </button>
    </header>

    <p v-if="detail?.description" class="series-description">
      {{ detail.description }}
    </p>

    <p v-if="error" class="error">{{ error }}</p>
    <div v-if="loading" class="empty">加载选集...</div>

    <template v-else-if="episodes.length">
      <div class="episode-toolbar">
        <span>{{ selectedEpisodes.length }} / {{ episodes.length }}</span>
        <button type="button" @click="toggleAll">
          {{ allEpisodesSelected ? "取消全选" : "全选" }}
        </button>
        <button
          type="button"
          :disabled="props.downloadingMany || selectedEpisodes.length === 0"
          @click="downloadSelected"
        >
          <Download :size="14" :stroke-width="2.3" />
          {{ props.downloadingMany ? "创建中..." : `下载选中 ${selectedEpisodes.length || ""}` }}
        </button>
      </div>

      <div class="episode-list">
        <article
          v-for="episode in episodes"
          :key="episodeKey(episode)"
          class="episode-row"
        >
          <label class="episode-check">
            <input
              type="checkbox"
              :checked="selectedIds.has(episodeKey(episode))"
              @change="toggleEpisode(episode, ($event.target as HTMLInputElement).checked)"
            />
          </label>
          <button type="button" @click="emit('play', episode, detail!)">
            <span>{{ episode.episodeNumber || "-" }}</span>
            <Play :size="14" :stroke-width="2.3" />
            <strong>{{ episode.title }}</strong>
          </button>
          <button type="button" @click="emit('download', episode, detail!)">
            <Download :size="14" :stroke-width="2.3" />
            下载
          </button>
        </article>
      </div>
    </template>

    <div v-else-if="!loading && !error" class="empty">没有选集</div>
  </aside>
</template>
