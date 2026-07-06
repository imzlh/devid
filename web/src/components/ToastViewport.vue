<script setup lang="ts">
import { AlertCircle, CheckCircle2, Info, XCircle } from "@lucide/vue";

export interface ToastItem {
  id: number;
  type: "success" | "error" | "info";
  message: string;
}

defineProps<{
  items: ToastItem[];
}>();
</script>

<template>
  <div class="toast-viewport" aria-live="polite" aria-atomic="false">
    <article
      v-for="item in items"
      :key="item.id"
      :class="['toast', item.type]"
    >
      <CheckCircle2
        v-if="item.type === 'success'"
        :size="18"
        :stroke-width="2.2"
      />
      <XCircle
        v-else-if="item.type === 'error'"
        :size="18"
        :stroke-width="2.2"
      />
      <AlertCircle
        v-else-if="item.type === 'info'"
        :size="18"
        :stroke-width="2.2"
      />
      <Info v-else :size="18" :stroke-width="2.2" />
      <span>{{ item.message }}</span>
    </article>
  </div>
</template>
