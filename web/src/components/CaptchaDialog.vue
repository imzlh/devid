<script setup lang="ts">
import { ref, watch } from "vue";
import { cancelCaptcha, captchaImageUrl, submitCaptcha } from "../api/client";
import type { CaptchaRequest } from "../types/api";

const props = defineProps<{
  request: CaptchaRequest | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const answer = ref("");
const error = ref("");
const submitting = ref(false);

watch(
  () => props.request?.requestId,
  () => {
    answer.value = "";
    error.value = "";
  },
);

async function submit() {
  if (!props.request || !answer.value.trim()) return;
  submitting.value = true;
  error.value = "";
  try {
    const result = await submitCaptcha(props.request.requestId, answer.value.trim());
    if (!result.success) throw new Error("验证码提交失败");
    emit("close");
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    submitting.value = false;
  }
}

async function cancel() {
  if (props.request) {
    await cancelCaptcha(props.request.requestId).catch(() => undefined);
  }
  emit("close");
}
</script>

<template>
  <div v-if="request" class="modal-backdrop">
    <form class="captcha-dialog" @submit.prevent="submit">
      <header>
        <h2>验证码</h2>
        <button type="button" @click="cancel">关闭</button>
      </header>

      <p>{{ request.prompt || "请输入验证码" }}</p>
      <img :src="captchaImageUrl(request.requestId)" alt="验证码" />

      <input
        v-model="answer"
        autocomplete="off"
        autofocus
        placeholder="输入验证码"
      />
      <p v-if="error" class="error">{{ error }}</p>

      <footer>
        <button type="button" @click="cancel">取消</button>
        <button type="submit" :disabled="submitting || !answer.trim()">
          {{ submitting ? "提交中..." : "提交" }}
        </button>
      </footer>
    </form>
  </div>
</template>
