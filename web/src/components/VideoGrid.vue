<script setup lang="ts">
import { Clapperboard, Download, LoaderCircle, X } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { proxiedImageUrl } from "../api/client";
import type { VideoItem } from "../types/api";

const props = defineProps<{
  items: VideoItem[];
  loading: boolean;
  currentPage: number;
  totalPages: number;
  loadingMore?: boolean;
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
  loadMore: [];
  select: [item: VideoItem];
  download: [item: VideoItem];
  remove: [item: VideoItem];
}>();

function secondaryActionLabel(item: VideoItem): string {
  if (item.contentType === "series") return "选集下载";
  if (item.contentType === "infinite") return "连载下载";
  return "下载";
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

function coverImageUrl(item: VideoItem): string {
  return item.thumbnail ? proxiedImageUrl(item.thumbnail, imageProxySourceFor(item)) : "";
}

function itemKey(item: VideoItem): string {
  return `${item.source}:${item.id}`;
}

const loadMoreTarget = ref<HTMLElement | null>(null);
const failedImages = ref<Set<string>>(new Set());
const hasMore = computed(() => props.currentPage < props.totalPages);
let loadMoreObserver: IntersectionObserver | null = null;

function imageKey(item: VideoItem): string {
  return `${itemKey(item)}:${item.thumbnail || ""}`;
}

function imageAvailable(item: VideoItem): boolean {
  return Boolean(item.thumbnail) && !failedImages.value.has(imageKey(item));
}

function handleImageError(item: VideoItem) {
  const next = new Set(failedImages.value);
  next.add(imageKey(item));
  failedImages.value = next;
}

function isBusy(item: VideoItem): boolean {
  return props.busyItems?.[itemKey(item)] ?? false;
}

function requestMore() {
  if (props.loading || props.loadingMore || !hasMore.value) return;
  emit("loadMore");
}

function setupLoadMoreObserver() {
  loadMoreObserver?.disconnect();
  if (!loadMoreTarget.value || typeof IntersectionObserver === "undefined") {
    return;
  }
  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) requestMore();
    },
    { rootMargin: "520px 0px 520px 0px" },
  );
  loadMoreObserver.observe(loadMoreTarget.value);
}

onMounted(setupLoadMoreObserver);
onBeforeUnmount(() => loadMoreObserver?.disconnect());

watch(loadMoreTarget, setupLoadMoreObserver);
watch([() => props.currentPage, () => props.totalPages], setupLoadMoreObserver);
watch(
  () => props.items,
  (items) => {
    const visibleKeys = new Set(items.map(imageKey));
    const next = new Set(
      [...failedImages.value].filter((key) => visibleKeys.has(key)),
    );
    if (next.size !== failedImages.value.size) failedImages.value = next;
  },
);
</script>

<template>
  <section
    class="video-area"
    :style="{ '--cover-aspect-ratio': defaultAspectRatio || '16/9' }"
  >
    <div
      v-if="loading && items.length === 0"
      class="skeleton-grid"
      aria-label="正在加载视频"
    >
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
        <button
          type="button"
          class="video-cover"
          :style="{ '--cover-aspect-ratio': aspectRatioFor(item) }"
          @click="emit('select', item)"
        >
          <img
            v-if="imageAvailable(item)"
            :src="coverImageUrl(item)"
            :alt="item.title"
            loading="lazy"
            @error="handleImageError(item)"
          />
          <div v-else class="poster-fallback">
            <strong>{{ item.title }}</strong>
            <span>{{ item.source }}</span>
          </div>
          <span v-if="item.duration" class="video-duration">
            {{ item.duration }}
          </span>
        </button>
        <div class="video-card-body">
          <div class="video-title-row">
            <strong :title="item.title">{{ item.title }}</strong>
            <div class="video-inline-actions">
              <button
                type="button"
                class="video-download"
                :aria-label="isBusy(item) ? '正在创建下载任务' : secondaryActionLabel(item)"
                :title="isBusy(item) ? '正在创建下载任务' : secondaryActionLabel(item)"
                :disabled="isBusy(item)"
                @click.stop="emit('download', item)"
              >
                <LoaderCircle
                  v-if="isBusy(item)"
                  class="spin-icon"
                  :size="18"
                  :stroke-width="2.25"
                />
                <Download v-else :size="18" :stroke-width="2.25" />
              </button>
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

    <footer
      v-if="items.length > 0 && totalPages > 1"
      ref="loadMoreTarget"
      class="load-more"
      aria-live="polite"
    >
      <button
        v-if="hasMore"
        type="button"
        :disabled="loading || loadingMore"
        @click="requestMore"
      >
        <LoaderCircle
          v-if="loadingMore"
          class="spin-icon"
          :size="16"
          :stroke-width="2.3"
        />
        {{ loadingMore ? "正在加载" : "加载更多" }}
      </button>
      <span v-else>已经到底了</span>
    </footer>
  </section>
</template>
