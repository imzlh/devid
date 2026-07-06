<script setup lang="ts">
import { Clapperboard, Download, LoaderCircle, Play, X } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { proxiedImageUrl } from "../api/client";
import type { VideoItem } from "../types/api";

const props = defineProps<{
  items: VideoItem[];
  loading: boolean;
  currentPage: number;
  totalPages: number;
  progress?: Record<string, number>;
  sourceAspectRatios?: Record<string, string>;
  sourceImageProxyIds?: Record<string, string>;
  busyItems?: Record<string, boolean>;
  defaultAspectRatio?: string;
  emptyTitle?: string;
  emptyText?: string;
  removable?: boolean;
}>();

const emit = defineEmits<{
  page: [page: number];
  select: [item: VideoItem];
  download: [item: VideoItem];
  remove: [item: VideoItem];
}>();

function primaryActionLabel(item: VideoItem): string {
  return item.contentType === "series" || item.contentType === "infinite"
    ? "选集"
    : "播放";
}

function secondaryActionLabel(item: VideoItem): string {
  if (item.contentType === "series") return "选集下载";
  if (item.contentType === "infinite") return "连载下载";
  return "下载";
}

function typeLabel(item: VideoItem): string {
  if (item.contentType === "series") return "剧集";
  if (item.contentType === "infinite") return "连载";
  return "视频";
}

function metaText(item: VideoItem): string {
  return [item.source, item.views, item.uploadTime].filter(Boolean).join(" · ");
}

function aspectRatioFor(item: VideoItem): string {
  return props.sourceAspectRatios?.[item.source] || props.defaultAspectRatio ||
    "16/9";
}

function imageProxySourceFor(item: VideoItem): string {
  return props.sourceImageProxyIds?.[item.source] || item.source;
}

function itemKey(item: VideoItem): string {
  return `${item.source}:${item.id}`;
}

const jumpPage = ref(props.currentPage);
const visiblePages = computed(() => {
  const total = props.totalPages;
  const current = props.currentPage;
  const max = 7;
  if (total <= max) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  let start = Math.max(1, current - Math.floor(max / 2));
  let end = start + max - 1;
  if (end > total) {
    end = total;
    start = Math.max(1, end - max + 1);
  }
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
});

watch(
  () => props.currentPage,
  (page) => {
    jumpPage.value = page;
  },
);

function goToPage(page: number) {
  const next = Math.max(1, Math.min(props.totalPages, Math.floor(page)));
  if (!Number.isFinite(next) || next === props.currentPage) return;
  emit("page", next);
}

function isBusy(item: VideoItem): boolean {
  return props.busyItems?.[itemKey(item)] ?? false;
}
</script>

<template>
  <section
    class="video-area"
    :style="{ '--cover-aspect-ratio': defaultAspectRatio || '16/9' }"
  >
    <div v-if="loading" class="skeleton-grid" aria-label="正在加载视频">
      <article v-for="item in 8" :key="item" class="skeleton-card">
        <span></span>
        <i></i>
        <b></b>
      </article>
    </div>
    <div v-else-if="items.length === 0" class="empty">
      <i class="empty-mark"><Clapperboard :size="21" :stroke-width="2.1" /></i>
      <strong>{{ emptyTitle || "没有视频" }}</strong>
      <span>{{ emptyText || "切换视频源或搜索其他关键词试试" }}</span>
    </div>

    <div v-else class="video-grid">
      <article
        v-for="item in items"
        :key="itemKey(item)"
        class="video-card"
      >
        <div
          class="video-cover"
          :style="{ '--cover-aspect-ratio': aspectRatioFor(item) }"
          role="button"
          tabindex="0"
          @click="emit('select', item)"
          @keydown.enter.prevent="emit('select', item)"
          @keydown.space.prevent="emit('select', item)"
        >
          <img
            v-if="item.thumbnail"
            :src="proxiedImageUrl(item.thumbnail, imageProxySourceFor(item))"
            :alt="item.title"
            loading="lazy"
          />
          <div v-else class="poster-fallback">{{ item.source }}</div>
          <span class="video-type">{{ typeLabel(item) }}</span>
          <span v-if="item.duration" class="video-duration">
            {{ item.duration }}
          </span>
          <div class="video-mask" aria-hidden="true"></div>
          <div class="video-card-actions">
            <button
              type="button"
              :aria-label="primaryActionLabel(item)"
              :title="primaryActionLabel(item)"
              @click.stop="emit('select', item)"
            >
              <Play :size="22" :stroke-width="2.25" />
            </button>
            <button
              type="button"
              :aria-label="isBusy(item) ? '正在创建下载任务' : secondaryActionLabel(item)"
              :title="isBusy(item) ? '正在创建下载任务' : secondaryActionLabel(item)"
              :disabled="isBusy(item)"
              @click.stop="emit('download', item)"
            >
              <LoaderCircle
                v-if="isBusy(item)"
                class="spin-icon"
                :size="21"
                :stroke-width="2.25"
              />
              <Download v-else :size="21" :stroke-width="2.25" />
            </button>
          </div>
        </div>
        <div class="video-card-body">
          <div class="video-title-row">
            <strong :title="item.title">{{ item.title }}</strong>
            <button
              v-if="removable"
              type="button"
              class="video-remove"
              aria-label="从最近观看移除"
              title="从最近观看移除"
              @click="emit('remove', item)"
            >
              <X :size="14" :stroke-width="2.4" />
            </button>
          </div>
          <span>{{ metaText(item) || item.source }}</span>
          <div
            v-if="progress?.[itemKey(item)]"
            class="watch-progress"
            :title="`已观看 ${progress[itemKey(item)]}%`"
          >
            <i :style="{ width: `${progress[itemKey(item)]}%` }"></i>
          </div>
        </div>
      </article>
    </div>

    <footer class="pager" v-if="totalPages > 1">
      <button
        :disabled="loading || currentPage <= 1"
        @click="goToPage(currentPage - 1)"
      >
        上一页
      </button>
      <div class="pager-pages" aria-label="分页">
        <button
          v-if="visiblePages[0] > 1"
          type="button"
          :disabled="loading"
          @click="goToPage(1)"
        >
          1
        </button>
        <span v-if="visiblePages[0] > 2">...</span>
        <button
          v-for="pageNum in visiblePages"
          :key="pageNum"
          type="button"
          :class="{ active: pageNum === currentPage }"
          :disabled="loading || pageNum === currentPage"
          @click="goToPage(pageNum)"
        >
          {{ pageNum }}
        </button>
        <span v-if="visiblePages[visiblePages.length - 1] < totalPages - 1">
          ...
        </span>
        <button
          v-if="visiblePages[visiblePages.length - 1] < totalPages"
          type="button"
          :disabled="loading"
          @click="goToPage(totalPages)"
        >
          {{ totalPages }}
        </button>
      </div>
      <form class="pager-jump" @submit.prevent="goToPage(jumpPage)">
        <input
          v-model.number="jumpPage"
          type="number"
          min="1"
          :max="totalPages"
          aria-label="跳转页码"
        />
        <button type="submit" :disabled="loading">跳转</button>
      </form>
      <button
        :disabled="loading || currentPage >= totalPages"
        @click="goToPage(currentPage + 1)"
      >
        下一页
      </button>
    </footer>
  </section>
</template>
