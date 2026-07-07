/**
 * 验证码处理工具
 * 提供简洁的 API 让视频源等待用户输入验证码
 *
 * 使用方式:
 *   import { captcha } from './utils/captcha.ts';
 *   const answer = await captcha({
 *       imageUrl: 'https://example.com/captcha.png',
 *       prompt: '请输入图中验证码'
 *   });
 */

import { logDebug, logInfo, logWarn } from "./logger.ts";
import { rpcServer } from "../websocket/rpc.ts";
import { validateUrl } from "./validation.ts";

// 验证码请求
interface CaptchaRequest {
  id: string;
  imageUrl: string; // 原始验证码图片 URL（用于后端获取）
  prompt: string;
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
  timeout: number;
  createdAt: number;
  timeoutId?: ReturnType<typeof setTimeout>;
}

// 验证码配置
interface CaptchaOptions {
  imageUrl: string; // 验证码图片 URL
  prompt?: string; // 提示文字
  timeout?: number; // 超时时间（毫秒），默认 5 分钟
}

// 验证码响应（返回给前端的结构）
export interface CaptchaResponse {
  requestId: string;
  captchaPageUrl?: string; // 旧前端兼容字段，Vue 前端直接使用 requestId
  prompt: string;
  createdAt: number;
}

// 默认超时时间：5 分钟
const DEFAULT_TIMEOUT = 5 * 60 * 1000;

// 等待中的验证码请求
const pendingRequests = new Map<string, CaptchaRequest>();

function normalizeRequestId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeCaptchaText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeTimeout(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_TIMEOUT;
}

/**
 * 推送验证码请求到前端
 */
function pushCaptchaRequest(request: CaptchaRequest): void {
  logDebug(`推送验证码请求: ${request.id}`);
  rpcServer.broadcast("captcha:required", {
    requestId: request.id,
    prompt: request.prompt || "请输入验证码",
    createdAt: request.createdAt,
  });
}

/**
 * 创建验证码请求并等待用户输入
 * @param options 验证码配置
 * @returns 用户输入的验证码
 */
export function captcha(options: CaptchaOptions): Promise<string> {
  const { imageUrl, prompt } = options;
  if (!validateUrl(imageUrl)) {
    return Promise.reject(new Error("无效的验证码图片URL"));
  }
  const normalizedImageUrl = new URL(imageUrl.trim()).href;
  const normalizedPrompt = normalizeCaptchaText(prompt, "请输入验证码");
  const timeout = normalizeTimeout(options.timeout);

  const id = crypto.randomUUID();

  logInfo(`创建验证码请求: ${id}`);

  return new Promise<string>((resolve, reject) => {
    const request: CaptchaRequest = {
      id,
      imageUrl: normalizedImageUrl,
      prompt: normalizedPrompt,
      resolve,
      reject,
      timeout,
      createdAt: Date.now(),
    };

    // 存储请求
    pendingRequests.set(id, request);

    // 推送到前端
    pushCaptchaRequest(request);

    // 设置超时
    const timeoutId = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`验证码请求超时: ${id}`));
        logWarn(`验证码请求超时: ${id}`);
        rpcServer.broadcast("captcha:cancelled", {
          requestId: id,
          reason: "验证码请求超时",
        });
      }
    }, timeout);

    // 保存 timeoutId 以便清理
    request.timeoutId = timeoutId;
  });
}

/**
 * 处理用户提交的验证码
 * @param requestId 请求 ID
 * @param answer 用户输入
 */
export function resolveCaptcha(requestId: string, answer: string): boolean {
  const normalizedRequestId = normalizeRequestId(requestId);
  const normalizedAnswer = normalizeCaptchaText(answer, "");
  if (!normalizedRequestId || !normalizedAnswer) {
    logWarn(`验证码提交参数无效: ${String(requestId)}`);
    return false;
  }

  const request = pendingRequests.get(normalizedRequestId);
  if (!request) {
    logWarn(`验证码请求不存在或已过期: ${normalizedRequestId}`);
    return false;
  }

  // 清理超时定时器
  const timeoutId = request.timeoutId;
  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  // 移除请求
  pendingRequests.delete(normalizedRequestId);

  // 解析 Promise
  request.resolve(normalizedAnswer);

  logInfo(`验证码已提交: ${normalizedRequestId}`);

  // 通知前端验证码已处理
  rpcServer.broadcast("captcha:resolved", {
    requestId: normalizedRequestId,
    success: true,
  });

  return true;
}

/**
 * 取消验证码请求
 * @param requestId 请求 ID
 * @param reason 取消原因
 */
export function cancelCaptcha(requestId: string, reason: string): boolean {
  const normalizedRequestId = normalizeRequestId(requestId);
  if (!normalizedRequestId) return false;

  const request = pendingRequests.get(normalizedRequestId);
  if (!request) {
    return false;
  }

  // 清理超时定时器
  const timeoutId = request.timeoutId;
  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  // 移除请求
  pendingRequests.delete(normalizedRequestId);

  // 拒绝 Promise
  const normalizedReason = normalizeCaptchaText(reason, "用户取消");
  request.reject(new Error(normalizedReason));

  logWarn(
    `验证码请求已取消: ${normalizedRequestId}, 原因: ${normalizedReason}`,
  );

  // 通知前端
  rpcServer.broadcast("captcha:cancelled", {
    requestId: normalizedRequestId,
    reason: normalizedReason,
  });

  return true;
}

/**
 * 获取验证码图片 URL（用于服务器中转）
 * @param requestId 请求 ID
 * @returns 原始图片 URL 或 null
 */
export function getCaptchaImageUrl(requestId: string): string | null {
  const normalizedRequestId = normalizeRequestId(requestId);
  if (!normalizedRequestId) return null;
  const request = pendingRequests.get(normalizedRequestId);
  return request?.imageUrl || null;
}

/**
 * 获取等待中的验证码请求数量
 */
export function getPendingCount(): number {
  return pendingRequests.size;
}

/**
 * 清理所有等待中的验证码请求
 */
export function clearAllPending(): void {
  for (const id of pendingRequests.keys()) {
    cancelCaptcha(id, "系统清理");
  }
  pendingRequests.clear();
}
