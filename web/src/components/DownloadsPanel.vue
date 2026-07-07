<script setup lang="ts">
import {
  CheckCircle2,
  Clock3,
  LoaderCircle,
  RotateCcw,
  Square,
  Trash2,
  XCircle,
} from "@lucide/vue";
import { computed } from "vue";
import type { DownloadTask } from "../types/api";

const props = defineProps<{
  tasks: DownloadTask[];
}>();

const emit = defineEmits<{
  refresh: [];
  cancel: [id: string];
  retry: [id: string];
  delete: [id: string, deleteFile: boolean];
  clear: [];
}>();

const statusLabel: Record<string, string> = {
  pending: "等待中",
  downloading: "下载中",
  completed: "已完成",
  error: "失败",
  cancelled: "已取消",
};

const stats = computed(() => ({
  active: props.tasks.filter((task) =>
    task.status === "downloading" || task.status === "pending"
  ).length,
  completed: props.tasks.filter((task) => task.status === "completed").length,
  failed: props.tasks.filter((task) =>
    task.status === "error" || task.status === "cancelled"
  ).length,
}));

function isActiveTask(task: DownloadTask): boolean {
  return task.status === "downloading" || task.status === "pending";
}

function progressValue(task: DownloadTask): number {
  return Math.max(0, Math.min(100, Math.round(task.progress || 0)));
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
</script>

<template>
  <header class="panel-header">
    <div>
      <strong>下载队列</strong>
      <span>{{ tasks.length }} 个任务</span>
    </div>
    <div class="panel-actions">
      <button type="button" @click="emit('refresh')">刷新</button>
      <button
        type="button"
        :disabled="stats.completed + stats.failed === 0"
        @click="emit('clear')"
      >
        清理已结束
      </button>
    </div>
  </header>

  <div class="download-summary">
    <span><b>{{ stats.active }}</b> 进行中</span>
    <span><b>{{ stats.completed }}</b> 已完成</span>
    <span><b>{{ stats.failed }}</b> 异常</span>
  </div>

  <div v-if="tasks.length === 0" class="empty">暂无下载任务</div>

  <div v-else class="download-list">
    <article v-for="task in tasks" :key="task.id" class="download-row">
      <div>
        <strong>{{ task.title }}</strong>
        <span>{{ task.fileName }}</span>
        <small>{{ formatTime(task.createTime) }}</small>
        <small v-if="task.error" class="download-error">{{ task.error }}</small>
      </div>
      <div class="download-state">
        <div class="download-meta">
          <span :class="['status', task.status]">
            <Clock3
              v-if="task.status === 'pending'"
              :size="13"
              :stroke-width="2.4"
            />
            <LoaderCircle
              v-else-if="task.status === 'downloading'"
              class="spin-icon"
              :size="13"
              :stroke-width="2.4"
            />
            <CheckCircle2
              v-else-if="task.status === 'completed'"
              :size="13"
              :stroke-width="2.4"
            />
            <XCircle v-else :size="13" :stroke-width="2.4" />
            {{ statusLabel[task.status] ?? task.status }}
          </span>
          <span>{{ progressValue(task) }}%</span>
        </div>
        <progress max="100" :value="progressValue(task)"></progress>
        <div class="download-actions">
          <button
            v-if="isActiveTask(task)"
            type="button"
            @click="emit('cancel', task.id)"
          >
            <Square :size="13" :stroke-width="2.5" />
            取消
          </button>
          <button
            v-if="task.status === 'error' || task.status === 'cancelled'"
            type="button"
            @click="emit('retry', task.id)"
          >
            <RotateCcw :size="13" :stroke-width="2.5" />
            重试
          </button>
          <button
            v-if="!isActiveTask(task)"
            type="button"
            @click="emit('delete', task.id, false)"
          >
            <Trash2 :size="13" :stroke-width="2.5" />
            删任务
          </button>
          <button
            v-if="task.status === 'completed' || task.status === 'error'"
            type="button"
            @click="emit('delete', task.id, true)"
          >
            <Trash2 :size="13" :stroke-width="2.5" />
            删文件
          </button>
        </div>
      </div>
    </article>
  </div>
</template>
