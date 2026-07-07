// utils/fetch.ts
import { DOMParser } from "dom";
import type { Document } from "dom";
import { logDebug, logError, logWarn } from "./logger.ts";
import config from "../config/index.ts";
import assert from "node:assert";
import { encodeBase64 } from "@std/encoding";

// 配置常量
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230901.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36";
const MAX_REDIRECTS = 10;
const DEFAULT_TIMEOUT = 30000;
const COOKIE_STORE_KEY_PREFIX = "c_";

// Cookie 存储接口
export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: Date;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  hostOnly?: boolean;
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
  options: FetchOptions & { useProxy?: boolean } = {},
): Promise<Document> {
  const headers = new Headers({
    "User-Agent": DEFAULT_USER_AGENT,
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "DNT": "1",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
  });
  for (const [key, value] of new Headers(options.headers)) {
    headers.set(key, value);
  }
  if (typeof options.referrer == "string" && options.referrer.trim()) {
    headers.set("Referer", options.referrer);
  }
  const response = await fetch2(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();
  const parser = new DOMParser();
  return parser.parseFromString(html, "text/html");
}

let gfw: boolean = false;
let warnedMissingProxyGateway = false;
try {
  const sig = new AbortController();
  setTimeout(() => sig.abort(), 1000);
  const res = await fetch("https://g.co", {
    signal: sig.signal,
  });
  assert(res.status == 200, "g.co is not accessible");
} catch {
  logWarn(
    "你正在中国内网访问，建议设置代理服务器加速访问，部分资源内网无法访问",
  );
  gfw = true;
}
export function useProxy(url: string | URL, options: FetchOptions = {}) {
  if (!gfw) return fetch(url, options);
  if (!config.get().proxy.gateway) {
    if (!warnedMissingProxyGateway) {
      warnedMissingProxyGateway = true;
      logWarn("已请求代理访问，但未配置代理网关；将直接请求，部分资源可能失败");
    }
    return fetch(url, options);
  }
  const headers = new Headers(options.headers);
  headers.set("X-Proxy-Destination", encodeBase64(String(url)));
  const _options = {
    ...options,
    headers,
  };
  logDebug(`Proxy request to ${url} with options ${JSON.stringify(_options)}`);
  return fetch(config.get().proxy.gateway, _options);
}

/**
 * 增强版 fetch，支持自动重定向和 cookie 处理
 * @param url - 目标 URL
 * @param options - 请求选项
 * @returns Promise<FetchResponse>
 */
export async function fetch2(
  url: string | URL,
  options: FetchOptions & { noRetry?: boolean; useProxy?: boolean } = {},
): Promise<FetchResponse> {
  const {
    maxRedirects = MAX_REDIRECTS,
    enableCookies = true,
    timeout = DEFAULT_TIMEOUT,
    noRetry = false,
    useProxy: shouldUseProxy = false,
    ...fetchOptions
  } = options;

  let currentUrl = String(url);
  let redirectCount = 0;
  let retryCount = 0;
  const cookieJar = enableCookies ? await loadCookies(currentUrl) : [];

  while (redirectCount <= maxRedirects) {
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), timeout);
    let cleanupSignal: (() => void) | undefined;
    try {
      const requestSignal = mergeSignals(
        fetchOptions.signal,
        timeoutController.signal,
      );
      cleanupSignal = requestSignal.cleanup;
      // 准备请求头
      const headers = new Headers({
        "User-Agent": DEFAULT_USER_AGENT,
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9,*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "DNT": "1",
      });
      for (const [key, value] of new Headers(fetchOptions.headers)) {
        headers.set(key, value);
      }

      // 添加 cookies
      if (enableCookies && cookieJar.length > 0) {
        const cookieHeader = buildCookieHeader(
          cookieJar,
          currentUrl,
          headers.get("Cookie"),
        );
        if (cookieHeader) headers.set("Cookie", cookieHeader);
      }

      // 发送请求
      const response = await (shouldUseProxy ? useProxy : fetch)(currentUrl, {
        ...fetchOptions,
        headers,
        redirect: "manual", // 手动处理重定向
        signal: requestSignal.signal,
      });
      clearTimeout(timeoutId);
      cleanupSignal();

      // 处理 cookies
      if (enableCookies) {
        const setCookieHeaders = getSetCookieHeaders(response.headers);
        if (setCookieHeaders.length > 0) {
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

        await response.body?.cancel().catch(() => undefined);
        currentUrl = new URL(location, currentUrl).toString();
        if (enableCookies) {
          updateCookieJar(cookieJar, await loadCookies(currentUrl));
        }
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
    } catch (error) {
      clearTimeout(timeoutId);
      cleanupSignal?.();
      if (noRetry || options?.signal?.aborted) throw error;
      retryCount++;
      if (retryCount > maxRedirects) {
        throw error;
      }
      logError(`Request failed, retry ${retryCount}: ${error}`);
    }
  }

  throw new Error(`Maximum retry or redirect (${maxRedirects}) exceeded`);
}

function mergeSignals(
  ...signals: (AbortSignal | null | undefined)[]
): { signal?: AbortSignal; cleanup: () => void } {
  const activeSignals = signals.filter((signal): signal is AbortSignal =>
    Boolean(signal)
  );
  if (activeSignals.length === 0) {
    return { signal: undefined, cleanup: () => {} };
  }
  if (activeSignals.length === 1) {
    return { signal: activeSignals[0], cleanup: () => {} };
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  const listeningSignals: AbortSignal[] = [];
  for (const signal of activeSignals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
    listeningSignals.push(signal);
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const signal of listeningSignals) {
        signal.removeEventListener("abort", abort);
      }
    },
  };
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
function getSetCookieHeaders(headers: Headers): string[] {
  const maybeHeaders = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof maybeHeaders.getSetCookie === "function") {
    return maybeHeaders.getSetCookie();
  }

  const combined = headers.get("set-cookie");
  return combined ? splitSetCookieHeader(combined) : [];
}

function parseSetCookie(
  setCookieHeader: string | string[],
  currentUrl: string,
): Cookie[] {
  const cookies: Cookie[] = [];
  const url = new URL(currentUrl);

  // 处理多个 Set-Cookie 头
  const cookieStrings = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : splitSetCookieHeader(setCookieHeader);

  for (const cookieString of cookieStrings) {
    const [nameValue, ...directives] = cookieString.split(";");
    const separatorIndex = nameValue.indexOf("=");
    if (separatorIndex <= 0) continue;
    const name = nameValue.slice(0, separatorIndex);
    const value = nameValue.slice(separatorIndex + 1);

    if (!name) continue;

    const cookie: Cookie = {
      name: name.trim(),
      value: value.trim(),
    };

    for (const directive of directives) {
      const trimmed = directive.trim();
      const separatorIndex = trimmed.indexOf("=");
      const key =
        (separatorIndex === -1 ? trimmed : trimmed.slice(0, separatorIndex))
          .toLowerCase();
      const val = separatorIndex === -1
        ? ""
        : trimmed.slice(separatorIndex + 1);

      switch (key) {
        case "domain":
          cookie.domain = val.toLowerCase();
          break;
        case "path":
          cookie.path = val || "/";
          break;
        case "expires":
          cookie.expires = parseCookieExpires(val);
          break;
        case "max-age":
          cookie.expires = maxAgeToExpires(val);
          break;
        case "secure":
          cookie.secure = true;
          break;
        case "httponly":
          cookie.httpOnly = true;
          break;
        case "samesite":
          cookie.sameSite = normalizeSameSite(val);
          break;
      }
    }

    // 设置默认值
    if (!cookie.path) cookie.path = "/";
    if (cookie.domain) {
      const cookieDomain = normalizeCookieDomain(cookie.domain);
      const hostname = url.hostname.toLowerCase();
      if (hostname !== cookieDomain && !hostname.endsWith(`.${cookieDomain}`)) {
        continue;
      }
      cookie.domain = cookieDomain;
    } else {
      cookie.domain = url.hostname.toLowerCase();
      cookie.hostOnly = true;
    }

    cookies.push(cookie);
  }

  return cookies;
}

function parseCookieExpires(value: string): Date | undefined {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : undefined;
}

function maxAgeToExpires(value: string): Date | undefined {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return undefined;
  return new Date(Date.now() + seconds * 1000);
}

function normalizeSameSite(value: string): Cookie["sameSite"] | undefined {
  switch (value.toLowerCase()) {
    case "strict":
      return "Strict";
    case "lax":
      return "Lax";
    case "none":
      return "None";
    default:
      return undefined;
  }
}

function splitSetCookieHeader(header: string): string[] {
  const cookies: string[] = [];
  let start = 0;

  for (let i = 0; i < header.length; i++) {
    if (header[i] === ",") {
      const next = header.slice(i + 1);
      if (/^\s*[^=;,\s]+=/.test(next)) {
        cookies.push(header.slice(start, i).trim());
        start = i + 1;
      }
    }
  }

  const tail = header.slice(start).trim();
  if (tail) cookies.push(tail);
  return cookies;
}

/**
 * 获取相关的 cookies
 */
function normalizeCookie(value: unknown): Cookie | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || !record.name.trim()) return null;
  if (typeof record.value !== "string") return null;

  const cookie: Cookie = {
    name: record.name.trim(),
    value: record.value.trim(),
  };

  if (typeof record.domain === "string" && record.domain.trim()) {
    cookie.domain = normalizeCookieDomain(record.domain);
  }
  if (typeof record.path === "string" && record.path.trim()) {
    cookie.path = record.path.trim();
  } else {
    cookie.path = "/";
  }
  if (record.expires instanceof Date) {
    cookie.expires = Number.isFinite(record.expires.getTime())
      ? record.expires
      : undefined;
  } else if (typeof record.expires === "string") {
    cookie.expires = parseCookieExpires(record.expires);
  }
  if (record.secure === true) cookie.secure = true;
  if (record.httpOnly === true) cookie.httpOnly = true;
  if (record.hostOnly === true) cookie.hostOnly = true;
  if (typeof record.sameSite === "string") {
    cookie.sameSite = normalizeSameSite(record.sameSite);
  }

  return cookie;
}

function normalizeCookieList(value: unknown): Cookie[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((cookie) => {
    const normalized = normalizeCookie(cookie);
    return normalized ? [normalized] : [];
  });
}

function getRelevantCookies(cookies: unknown, url: string): Cookie[] {
  const urlObj = new URL(url);
  const now = new Date();

  return normalizeCookieList(cookies).filter((cookie) => {
    // 检查过期时间
    if (cookie.expires && cookie.expires <= now) return false;

    // 检查域名匹配
    if (cookie.domain) {
      const cookieDomain = normalizeCookieDomain(cookie.domain);
      if (cookie.hostOnly) {
        if (urlObj.hostname !== cookieDomain) return false;
      } else {
        const urlDomain = `.${urlObj.hostname}`;
        if (!urlDomain.endsWith(`.${cookieDomain}`)) return false;
      }
    }

    // 检查路径匹配
    if (cookie.path && !cookiePathMatches(urlObj.pathname, cookie.path)) {
      return false;
    }

    // 检查 secure 属性
    if (cookie.secure && urlObj.protocol !== "https:") return false;

    return true;
  });
}

export function buildCookieHeader(
  cookies: unknown,
  url: string,
  existingCookieHeader?: string | null,
): string {
  const relevantCookies = getRelevantCookies(cookies, url);
  const cookieString = relevantCookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  const existing = existingCookieHeader?.trim();
  if (!existing) return cookieString;
  return cookieString ? `${existing}; ${cookieString}` : existing;
}

export function cookiePathMatches(
  requestPath: string,
  cookiePath: string,
): boolean {
  if (!cookiePath || cookiePath === "/") return true;
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
}

/**
 * 更新 cookie 存储
 */
function updateCookieJar(existingCookies: Cookie[], newCookies: unknown): void {
  existingCookies.splice(0, existingCookies.length, ...normalizeCookieList(existingCookies));
  for (const newCookie of normalizeCookieList(newCookies)) {
    // 移除同名的旧 cookie
    const existingIndex = existingCookies.findIndex(
      (c) =>
        c.name === newCookie.name && c.domain === newCookie.domain &&
        c.path === newCookie.path,
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

function normalizeCookieDomain(domain: string): string {
  return domain.trim().replace(/^\./, "").toLowerCase();
}

function cookieStorageDomains(
  hostname: string,
  cookies: Cookie[] = [],
): string[] {
  const domains = new Set<string>();
  const normalizedHostname = hostname.toLowerCase();
  if (isIpAddress(normalizedHostname) || !normalizedHostname.includes(".")) {
    domains.add(normalizedHostname);
  } else {
    const parts = normalizedHostname.split(".");
    for (let i = 0; i < parts.length - 1; i++) {
      const domain = parts.slice(i).join(".");
      if (domain) domains.add(domain);
    }
  }
  for (const cookie of cookies) {
    if (cookie.domain) domains.add(normalizeCookieDomain(cookie.domain));
  }
  return [...domains];
}

function isIpAddress(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

function mergeCookieLists(lists: Cookie[][]): Cookie[] {
  const merged: Cookie[] = [];
  for (const cookies of lists) {
    updateCookieJar(merged, cookies);
  }
  return merged;
}

/**
 * 从 KV 存储加载 cookies
 */
async function loadCookies(url: string): Promise<Cookie[]> {
  let kv: Deno.Kv | undefined;
  try {
    kv = await Deno.openKv();
    const urlObj = new URL(url);
    const results: Cookie[][] = [];
    for (const domain of cookieStorageDomains(urlObj.hostname)) {
      const result = await kv.get<Cookie[]>([COOKIE_STORE_KEY_PREFIX, domain]);
      if (result.value) results.push(normalizeCookieList(result.value));
    }

    return mergeCookieLists(results);
  } catch (error) {
    logWarn("Failed to load cookies from KV:", error);
    return [];
  } finally {
    kv?.close();
  }
}

/**
 * 保存 cookies 到 KV 存储
 */
async function saveCookies(url: string, cookies: Cookie[]): Promise<void> {
  let kv: Deno.Kv | undefined;
  try {
    kv = await Deno.openKv();
    const urlObj = new URL(url);

    // 过滤掉过期的 cookies
    const validCookies = normalizeCookieList(cookies).filter((cookie) =>
      !cookie.expires || cookie.expires > new Date()
    );

    for (const domain of cookieStorageDomains(urlObj.hostname, validCookies)) {
      await kv.set([COOKIE_STORE_KEY_PREFIX, domain], validCookies);
    }
  } catch (error) {
    logWarn("Failed to save cookies to KV:", error);
  } finally {
    kv?.close();
  }
}

/**
 * 清除指定域名的 cookies
 */
export async function clearCookies(domain?: string): Promise<void> {
  let kv: Deno.Kv | undefined;
  try {
    kv = await Deno.openKv();

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
  } catch (error) {
    logWarn("Failed to clear cookies:", error);
  } finally {
    kv?.close();
  }
}

/**
 * 获取指定域名的 cookies
 */
export async function getCookies(domain: string): Promise<Cookie[]> {
  let kv: Deno.Kv | undefined;
  try {
    kv = await Deno.openKv();
    const key = [COOKIE_STORE_KEY_PREFIX, domain];
    const result = await kv.get<Cookie[]>(key);

    return normalizeCookieList(result.value);
  } catch (error) {
    logWarn("Failed to get cookies:", error);
    return [];
  } finally {
    kv?.close();
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
  options: RequestInit & { useProxy?: boolean } = {},
): Promise<import("../sources/index.ts").ImageData> {
  try {
    const response = await fetch2(url, options);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // 获取内容类型
    let contentType = response.headers.get("content-type") || "";
    if (contentType && !isImageLikeContentType(contentType)) {
      throw new Error(`Unexpected image content type: ${contentType}`);
    }

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

export function isImageLikeContentType(contentType: string): boolean {
  const normalized = contentType.split(";")[0].trim().toLowerCase();
  return normalized.startsWith("image/") ||
    normalized === "application/octet-stream";
}

export function imagePayloadError(
  data: unknown,
  contentType: string,
): string | null {
  if (!isImageLikeContentType(contentType)) return "图片响应类型无效";
  if (!(data instanceof Uint8Array) || data.byteLength === 0) {
    return "图片响应为空";
  }
  return null;
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
  options: CheckURLOptions = {},
): Promise<CheckResult> {
  const startTime = Date.now();
  const {
    timeout = 5000,
    method = "HEAD",
    validStatus = (status: number) => status >= 200 && status < 400,
    followRedirect = true,
    headers = {},
  } = options;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        ...headers,
      },
      redirect: followRedirect ? "follow" : "manual",
      signal: AbortSignal.timeout(timeout),
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
      redirectUrl: response.url !== url ? response.url : undefined,
    };
  } catch (error) {
    return {
      url,
      available: false,
      responseTime: Date.now() - startTime,
      error: String(error),
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
export async function findAvailableFast(
  urls: string[],
): Promise<string | null> {
  const promises = urls.map((url) => checkURL(url));
  const results = await Promise.all(promises);
  return results.find((r) => r.available)?.url || null;
}

/**
 * 找到所有可用的 URL
 */
export async function findAllAvailable(urls: string[]): Promise<string[]> {
  const promises = urls.map((url) => checkURL(url));
  const results = await Promise.all(promises);
  return results.filter((r) => r.available).map((r) => r.url);
}

/**
 * 找到最快可用的 URL
 */
export async function findFastestAvailable(
  urls: string[],
): Promise<string | null> {
  const promises = urls.map((url) => checkURL(url));
  const results = await Promise.all(promises);

  const availableResults = results.filter((r) => r.available);
  if (availableResults.length === 0) return null;

  return availableResults.reduce((fastest, current) =>
    (current.responseTime || Infinity) < (fastest.responseTime || Infinity)
      ? current
      : fastest
  ).url;
}

/**
 * 带详细信息的 findAvailable
 */
export async function findAvailableDetailed(
  urls: string[],
): Promise<CheckResult | null> {
  const promises = urls.map((url) => checkURL(url));
  const results = await Promise.all(promises);
  return results.find((r) => r.available) || null;
}

/**
 * 检查镜像站点（支持自定义检查逻辑）
 */
export async function findMirrorAvailable(
  urls: string[],
  options: CheckURLOptions = {},
): Promise<string | null> {
  const promises = urls.map((url) =>
    checkURL(url, {
      method: "GET",
      validStatus: 200,
      timeout: 10000,
      ...options,
      headers: {
        "Accept": "text/html,application/xhtml+xml",
        ...options.headers,
      },
    })
  );

  const results = await Promise.all(promises);
  return results.find((r) => r.available)?.url || null;
}

/**
 * 健康检查（检查多个端点，任意一个可用即返回）
 */
export async function healthCheck(
  baseUrl: string,
  endpoints: string[] = ["/health", "/status", "/ping", "/"],
): Promise<string | null> {
  const urls = endpoints.map((endpoint) =>
    new URL(endpoint, baseUrl).toString()
  );
  return await findAvailableFast(urls);
}
