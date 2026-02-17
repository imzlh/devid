// utils/fetch.ts
import { DOMParser } from "dom";
import type { Document } from "dom";
import { logError, logWarn } from "./logger.ts";

// 配置常量
const DEFAULT_USER_AGENT = "Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230901.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36";
const MAX_REDIRECTS = 10;
const DEFAULT_TIMEOUT = 30000;
const COOKIE_STORE_KEY_PREFIX = "c_";

// Cookie 存储接口
interface Cookie {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: Date;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
}

interface FetchOptions extends RequestInit {
    maxRedirects?: number;
    enableCookies?: boolean;
    timeout?: number;
}

interface FetchResponse extends Response {
    finalUrl: string;
    redirectCount: number;
}

/**
 * 获取 HTML 文档对象
 * @param url - 目标 URL
 * @param options - 请求选项
 * @returns Promise<Document>
 */
export async function getDocument(
    url: string | URL,
    options: FetchOptions = {}
): Promise<Document> {
    if (typeof options.referrer == 'string' && options.headers) {
        // @ts-ignore - set referer
        options.headers.Referer = options.referrer;
    }
    const response = await fetch2(url, {
        ...options,
        headers: {
            "User-Agent": DEFAULT_USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            "DNT": "1",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            ...options.headers
        }
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const parser = new DOMParser();
    return parser.parseFromString(html, "text/html");
}

/**
 * 增强版 fetch，支持自动重定向和 cookie 处理
 * @param url - 目标 URL
 * @param options - 请求选项
 * @returns Promise<FetchResponse>
 */
export async function fetch2(
    url: string | URL,
    options: FetchOptions & { noRetry?: boolean } = {}
): Promise<FetchResponse> {
    const {
        maxRedirects = MAX_REDIRECTS,
        enableCookies = true,
        timeout = DEFAULT_TIMEOUT,
        ...fetchOptions
    } = options;

    // 创建 AbortController 用于超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        let currentUrl = String(url);
        let redirectCount = 0;
        const cookieJar = enableCookies ? await loadCookies(currentUrl) : [];

        while (redirectCount <= maxRedirects) {
            // 准备请求头
            const headers = new Headers({
                "User-Agent": DEFAULT_USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "Accept-Encoding": "gzip, deflate, br",
                "DNT": "1",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1",
                ...fetchOptions.headers
            });

            // 添加 cookies
            if (enableCookies && cookieJar.length > 0) {
                const relevantCookies = getRelevantCookies(cookieJar, currentUrl);
                if (relevantCookies.length > 0) {
                    const cookieString = relevantCookies
                        .map(cookie => `${cookie.name}=${cookie.value}`)
                        .join("; ");
                    headers.set("Cookie", cookieString);
                }
            }

            // 发送请求
            let response;
            try{
                response = await fetch(currentUrl, {
                    ...fetchOptions,
                    headers,
                    signal: controller.signal,
                    redirect: "manual", // 手动处理重定向
                });
                // 获取到响应后清除超时，允许大文件下载完成
                clearTimeout(timeoutId);
            }catch(e){
                if (options.noRetry) throw e;
                console.warn(`请求失败，重试 ${redirectCount += 1} 次: ${e}`);
                continue;
            }

            // 处理 cookies
            if (enableCookies) {
                const setCookieHeaders = response.headers.get("set-cookie");
                if (setCookieHeaders) {
                    const newCookies = parseSetCookie(setCookieHeaders, currentUrl);
                    updateCookieJar(cookieJar, newCookies);
                }
            }

            // 处理重定向
            if (isRedirect(response.status)) {
                if (redirectCount >= maxRedirects) {
                    throw new Error(`Maximum redirects (${maxRedirects}) exceeded`);
                }

                const location = response.headers.get("location");
                if (!location) {
                    throw new Error("Redirect response missing Location header");
                }

                currentUrl = new URL(location, currentUrl).toString();
                redirectCount++;

                // 对于 307/308 重定向，保持原始请求方法和主体
                if (response.status !== 307 && response.status !== 308) {
                    fetchOptions.method = "GET";
                    delete fetchOptions.body;
                }

                continue;
            }

            // 保存 cookies
            if (enableCookies) {
                await saveCookies(currentUrl, cookieJar);
            }

            // 创建增强响应对象
            const enhancedResponse = Object.create(response);
            enhancedResponse.finalUrl = currentUrl;
            enhancedResponse.redirectCount = redirectCount;

            return enhancedResponse as FetchResponse;
        }

        throw new Error(`Maximum redirects (${maxRedirects}) exceeded`);
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * 判断是否为重定向状态码
 */
function isRedirect(status: number): boolean {
    return status === 301 || status === 302 || status === 303 ||
        status === 307 || status === 308;
}

/**
 * 解析 Set-Cookie 头
 */
function parseSetCookie(setCookieHeader: string, currentUrl: string): Cookie[] {
    const cookies: Cookie[] = [];
    const url = new URL(currentUrl);

    // 处理多个 Set-Cookie 头
    const cookieStrings = setCookieHeader.split(/,(?=[^;]*=)/);

    for (const cookieString of cookieStrings) {
        const [nameValue, ...directives] = cookieString.split(";");
        const [name, value] = nameValue.trim().split("=");

        if (!name || !value) continue;

        const cookie: Cookie = {
            name: name.trim(),
            value: decodeURIComponent(value.trim())
        };

        for (const directive of directives) {
            const [key, val] = directive.trim().toLowerCase().split("=");

            switch (key) {
                case "domain":
                    cookie.domain = val;
                    break;
                case "path":
                    cookie.path = val || "/";
                    break;
                case "expires":
                    cookie.expires = new Date(val);
                    break;
                case "secure":
                    cookie.secure = true;
                    break;
                case "httponly":
                    cookie.httpOnly = true;
                    break;
                case "samesite":
                    cookie.sameSite = val as "Strict" | "Lax" | "None";
                    break;
            }
        }

        // 设置默认值
        if (!cookie.path) cookie.path = "/";
        if (!cookie.domain) cookie.domain = url.hostname;

        cookies.push(cookie);
    }

    return cookies;
}

/**
 * 获取相关的 cookies
 */
function getRelevantCookies(cookies: Cookie[], url: string): Cookie[] {
    const urlObj = new URL(url);
    const now = new Date();

    return cookies.filter(cookie => {
        // 检查过期时间
        if (cookie.expires && cookie.expires < now) return false;

        // 检查域名匹配
        if (cookie.domain) {
            const cookieDomain = cookie.domain.startsWith(".") ? cookie.domain : `.${cookie.domain}`;
            const urlDomain = `.${urlObj.hostname}`;
            if (!urlDomain.endsWith(cookieDomain)) return false;
        }

        // 检查路径匹配
        if (cookie.path && !urlObj.pathname.startsWith(cookie.path)) return false;

        // 检查 secure 属性
        if (cookie.secure && urlObj.protocol !== "https:") return false;

        return true;
    });
}

/**
 * 更新 cookie 存储
 */
function updateCookieJar(existingCookies: Cookie[], newCookies: Cookie[]): void {
    for (const newCookie of newCookies) {
        // 移除同名的旧 cookie
        const existingIndex = existingCookies.findIndex(
            c => c.name === newCookie.name && c.domain === newCookie.domain && c.path === newCookie.path
        );

        if (existingIndex !== -1) {
            existingCookies.splice(existingIndex, 1);
        }

        // 添加新 cookie（如果未过期）
        if (!newCookie.expires || newCookie.expires > new Date()) {
            existingCookies.push(newCookie);
        }
    }
}

/**
 * 从 KV 存储加载 cookies
 */
async function loadCookies(url: string): Promise<Cookie[]> {
    try {
        const kv = await Deno.openKv();
        const urlObj = new URL(url);
        const key = [COOKIE_STORE_KEY_PREFIX, urlObj.hostname];

        const result = await kv.get<Cookie[]>(key);
        await kv.close();

        return result.value || [];
    } catch (error) {
        logWarn("Failed to load cookies from KV:", error);
        return [];
    }
}

/**
 * 保存 cookies 到 KV 存储
 */
async function saveCookies(url: string, cookies: Cookie[]): Promise<void> {
    try {
        const kv = await Deno.openKv();
        const urlObj = new URL(url);
        const key = [COOKIE_STORE_KEY_PREFIX, urlObj.hostname];

        // 过滤掉过期的 cookies
        const validCookies = cookies.filter(cookie =>
            !cookie.expires || cookie.expires > new Date()
        );

        await kv.set(key, validCookies);
        await kv.close();
    } catch (error) {
        logWarn("Failed to save cookies to KV:", error);
    }
}

/**
 * 清除指定域名的 cookies
 */
export async function clearCookies(domain?: string): Promise<void> {
    try {
        const kv = await Deno.openKv();

        if (domain) {
            const key = [COOKIE_STORE_KEY_PREFIX, domain];
            await kv.delete(key);
        } else {
            // 清除所有 cookies
            const entries = kv.list({ prefix: [COOKIE_STORE_KEY_PREFIX] });
            for await (const entry of entries) {
                await kv.delete(entry.key);
            }
        }

        await kv.close();
    } catch (error) {
        logWarn("Failed to clear cookies:", error);
    }
}

/**
 * 获取指定域名的 cookies
 */
export async function getCookies(domain: string): Promise<Cookie[]> {
    try {
        const kv = await Deno.openKv();
        const key = [COOKIE_STORE_KEY_PREFIX, domain];
        const result = await kv.get<Cookie[]>(key);
        await kv.close();

        return result.value || [];
    } catch (error) {
        logWarn("Failed to get cookies:", error);
        return [];
    }
}

/**
 * 获取图片数据并返回ImageData对象
 * @param url 图片URL
 * @param options 可选的fetch选项
 * @returns 包含图片数据和内容类型的ImageData对象
 */
export async function getImage(
    url: string,
    options: RequestInit = {}
): Promise<import("../sources/index.ts").ImageData> {
    try {
        const response = await fetch2(url, options);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // 获取内容类型
        let contentType = response.headers.get("content-type") || "";

        // 如果响应头中没有内容类型，尝试从URL推断
        if (!contentType) {
            const urlLower = url.toLowerCase();
            if (urlLower.endsWith(".png")) {
                contentType = "image/png";
            } else if (urlLower.endsWith(".jpg") || urlLower.endsWith(".jpeg")) {
                contentType = "image/jpeg";
            } else if (urlLower.endsWith(".webp")) {
                contentType = "image/webp";
            } else if (urlLower.endsWith(".gif")) {
                contentType = "image/gif";
            } else {
                // 默认假设为jpeg
                contentType = "image/jpeg";
            }
        }

        // 获取图片数据
        const arrayBuffer = await response.arrayBuffer();
        // 转换为 Uint8Array 而不是 Uint8ClampedArray
        const data = new Uint8Array(arrayBuffer);

        return {
            data,
            contentType,
        };
    } catch (error) {
        logError("获取图片失败:", error);
        throw error;
    }
}

// 在 fetch.ts 末尾添加：

// URL 检查选项
interface CheckURLOptions {
    timeout?: number;
    method?: string;
    validStatus?: number | number[] | ((status: number) => boolean);
    followRedirect?: boolean;
    headers?: Record<string, string>;
}

// URL 检查结果
interface CheckResult {
    url: string;
    available: boolean;
    status?: number;
    statusText?: string;
    responseTime?: number;
    error?: string;
    redirectUrl?: string;
}

/**
 * 核心 URL 检查函数
 */
async function checkURL(
    url: string,
    options: CheckURLOptions = {}
): Promise<CheckResult> {
    const startTime = Date.now();
    const {
        timeout = 5000,
        method = "HEAD",
        validStatus = (status: number) => status >= 200 && status < 400,
        followRedirect = true,
        headers = {}
    } = options;

    try {
        const response = await fetch(url, {
            method,
            headers: {
                "User-Agent": DEFAULT_USER_AGENT,
                ...headers
            },
            redirect: followRedirect ? "follow" : "manual",
            signal: AbortSignal.timeout(timeout)
        });

        const statusValid = typeof validStatus === "function"
            ? validStatus(response.status)
            : Array.isArray(validStatus)
                ? validStatus.includes(response.status)
                : validStatus === response.status;

        return {
            url,
            available: statusValid,
            status: response.status,
            statusText: response.statusText,
            responseTime: Date.now() - startTime,
            redirectUrl: response.url !== url ? response.url : undefined
        };

    } catch (error) {
        return {
            url,
            available: false,
            responseTime: Date.now() - startTime,
            error: String(error)
        };
    }
}

/**
 * 基础 findAvailable - 找到第一个可用的 URL
 */
export async function findAvailable(urls: string[]): Promise<string | null> {
    for (const url of urls) {
        const result = await checkURL(url);
        if (result.available) return url;
    }
    return null;
}

/**
 * 并行检查所有 URL，返回第一个可用的
 */
export async function findAvailableFast(urls: string[]): Promise<string | null> {
    const promises = urls.map(url => checkURL(url));
    const results = await Promise.all(promises);
    return results.find(r => r.available)?.url || null;
}

/**
 * 找到所有可用的 URL
 */
export async function findAllAvailable(urls: string[]): Promise<string[]> {
    const promises = urls.map(url => checkURL(url));
    const results = await Promise.all(promises);
    return results.filter(r => r.available).map(r => r.url);
}

/**
 * 找到最快可用的 URL
 */
export async function findFastestAvailable(urls: string[]): Promise<string | null> {
    const promises = urls.map(url => checkURL(url));
    const results = await Promise.all(promises);

    const availableResults = results.filter(r => r.available);
    if (availableResults.length === 0) return null;

    return availableResults.reduce((fastest, current) =>
        (current.responseTime || Infinity) < (fastest.responseTime || Infinity) ? current : fastest
    ).url;
}

/**
 * 带详细信息的 findAvailable
 */
export async function findAvailableDetailed(urls: string[]): Promise<CheckResult | null> {
    const promises = urls.map(url => checkURL(url));
    const results = await Promise.all(promises);
    return results.find(r => r.available) || null;
}

/**
 * 检查镜像站点（支持自定义检查逻辑）
 */
export async function findMirrorAvailable(
    urls: string[],
    options: CheckURLOptions = {}
): Promise<string | null> {
    const promises = urls.map(url => checkURL(url, {
        method: "GET",
        validStatus: 200,
        timeout: 10000,
        ...options,
        headers: {
            "Accept": "text/html,application/xhtml+xml",
            ...options.headers
        }
    }));

    const results = await Promise.all(promises);
    return results.find(r => r.available)?.url || null;
}

/**
 * 健康检查（检查多个端点，任意一个可用即返回）
 */
export async function healthCheck(
    baseUrl: string,
    endpoints: string[] = ["/health", "/status", "/ping", "/"]
): Promise<string | null> {
    const urls = endpoints.map(endpoint => new URL(endpoint, baseUrl).toString());
    return await findAvailableFast(urls);
}
