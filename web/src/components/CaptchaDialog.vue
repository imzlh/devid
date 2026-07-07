<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
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
const imageError = ref("");
const submitting = ref(false);
const answerInput = ref<HTMLInputElement | null>(null);
let submitToken = 0;

watch(
  () => props.request?.requestId,
  () => {
    submitToken++;
    answer.value = "";
    error.value = "";
    imageError.value = "";
    submitting.value = false;
    if (props.request) {
      void nextTick(() => answerInput.value?.focus());
    }
  },
);

async function submit() {
  if (!props.request || !answer.value.trim()) return;
  const requestId = props.request.requestId;
  const token = ++submitToken;
  submitting.value = true;
  error.value = "";
  try {
    const result = await submitCaptcha(requestId, answer.value.trim());
    if (token !== submitToken || props.request?.requestId !== requestId) return;
    if (!result.success) throw new Error("验证码提交失败");
    emit("close");
  } catch (err) {
    if (token !== submitToken || props.request?.requestId !== requestId) return;
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    if (token === submitToken && props.request?.requestId === requestId) {
      submitting.value = false;
    }
  }
}

async function cancel() {
  const requestId = props.request?.requestId;
  if (requestId) {
    submitToken++;
    submitting.value = false;
    await cancelCaptcha(requestId).catch(() => undefined);
  }
  emit("close");
}
</script>

<template>
  <div v-if="request" class="modal-backdrop">
    <form
      class="captcha-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="captcha-title"
      @submit.prevent="submit"
    >
      <header>
        <h2 id="captcha-title">验证码</h2>
        <button type="button" :disabled="submitting" @click="cancel">关闭</button>
      </header>

      <p>{{ request.prompt || "请输入验证码" }}</p>
      <img
        v-if="!imageError"
        :src="captchaImageUrl(request.requestId)"
        alt="验证码"
        @error="imageError = '验证码图片加载失败'"
      />
      <p v-else class="error" role="alert">{{ imageError }}</p>

      <input
        ref="answerInput"
        v-model="answer"
        aria-label="验证码"
        autocomplete="off"
        autofocus
        placeholder="输入验证码"
      />
      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <footer>
        <button type="button" :disabled="submitting" @click="cancel">取消</button>
        <button type="submit" :disabled="submitting || !answer.trim()">
          {{ submitting ? "提交中..." : "提交" }}
        </button>
      </footer>
    </form>
  </div>
</template>
