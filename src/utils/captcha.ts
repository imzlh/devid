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

import { logInfo, logDebug, logWarn } from "./logger.ts";
import { rpcServer } from "../websocket/rpc.ts";

// 验证码请求
interface CaptchaRequest {
    id: string;
    imageUrl: string;       // 原始验证码图片 URL（用于后端获取）
    prompt: string;
    resolve: (answer: string) => void;
    reject: (error: Error) => void;
    timeout: number;
    createdAt: number;
}

// 验证码配置
interface CaptchaOptions {
    imageUrl: string;       // 验证码图片 URL
    prompt?: string;        // 提示文字
    timeout?: number;       // 超时时间（毫秒），默认 5 分钟
}

// 验证码响应（返回给前端的结构）
export interface CaptchaResponse {
    requestId: string;
    captchaPageUrl: string;  // 完整的验证码页面 URL
    prompt: string;
    createdAt: number;
}

// 默认超时时间：5 分钟
const DEFAULT_TIMEOUT = 5 * 60 * 1000;

// 等待中的验证码请求
const pendingRequests = new Map<string, CaptchaRequest>();

/**
 * 构建验证码页面 URL
 */
function buildCaptchaPageUrl(requestId: string): string {
    // 后端提供完整的验证码页面 URL
    return `/captcha.html?requestId=${encodeURIComponent(requestId)}`;
}

/**
 * 推送验证码请求到前端
 */
function pushCaptchaRequest(request: CaptchaRequest): void {
    logDebug(`推送验证码请求: ${request.id}`);
    const captchaPageUrl = buildCaptchaPageUrl(request.id);
    rpcServer.broadcast("captcha:required", {
        requestId: request.id,
        captchaPageUrl: captchaPageUrl,
        prompt: request.prompt || "请输入验证码",
        createdAt: request.createdAt
    });
}

/**
 * 创建验证码请求并等待用户输入
 * @param options 验证码配置
 * @returns 用户输入的验证码
 */
export async function captcha(options: CaptchaOptions): Promise<string> {
    const { imageUrl, prompt, timeout = DEFAULT_TIMEOUT } = options;

    const id = crypto.randomUUID();

    logInfo(`创建验证码请求: ${id}`);

    return new Promise<string>((resolve, reject) => {
        const request: CaptchaRequest = {
            id,
            imageUrl,
            prompt: prompt || "请输入验证码",
            resolve,
            reject,
            timeout,
            createdAt: Date.now()
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
            }
        }, timeout);

        // 保存 timeoutId 以便清理
        (request as CaptchaRequest & { timeoutId?: number }).timeoutId = timeoutId;
    });
}

/**
 * 处理用户提交的验证码
 * @param requestId 请求 ID
 * @param answer 用户输入
 */
export function resolveCaptcha(requestId: string, answer: string): boolean {
    const request = pendingRequests.get(requestId);
    if (!request) {
        logWarn(`验证码请求不存在或已过期: ${requestId}`);
        return false;
    }

    // 清理超时定时器
    const timeoutId = (request as CaptchaRequest & { timeoutId?: number }).timeoutId;
    if (timeoutId) {
        clearTimeout(timeoutId);
    }

    // 移除请求
    pendingRequests.delete(requestId);

    // 解析 Promise
    request.resolve(answer);

    logInfo(`验证码已提交: ${requestId}, 答案: ${answer}`);

    // 通知前端验证码已处理
    rpcServer.broadcast("captcha:resolved", {
        requestId,
        success: true
    });

    return true;
}

/**
 * 取消验证码请求
 * @param requestId 请求 ID
 * @param reason 取消原因
 */
export function cancelCaptcha(requestId: string, reason: string): boolean {
    const request = pendingRequests.get(requestId);
    if (!request) {
        return false;
    }

    // 清理超时定时器
    const timeoutId = (request as CaptchaRequest & { timeoutId?: number }).timeoutId;
    if (timeoutId) {
        clearTimeout(timeoutId);
    }

    // 移除请求
    pendingRequests.delete(requestId);

    // 拒绝 Promise
    request.reject(new Error(reason));

    logWarn(`验证码请求已取消: ${requestId}, 原因: ${reason}`);

    // 通知前端
    rpcServer.broadcast("captcha:cancelled", {
        requestId,
        reason
    });

    return true;
}

/**
 * 获取验证码图片 URL（用于服务器中转）
 * @param requestId 请求 ID
 * @returns 原始图片 URL 或 null
 */
export function getCaptchaImageUrl(requestId: string): string | null {
    const request = pendingRequests.get(requestId);
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
    for (const [id, request] of pendingRequests) {
        cancelCaptcha(id, "系统清理");
    }
    pendingRequests.clear();
}
