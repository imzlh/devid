import type { Hono } from "hono";
import type { ServerContext } from "./context.ts";
import { M3U8Parser, M3U8Service } from "../utils/m3u8.ts";
import { fetch2, imagePayloadError } from "../utils/fetch.ts";
import { logDebug, logError, logWarn } from "../utils/logger.ts";
import {
  looksLikeH5Url,
  looksLikeM3u8Url,
  mediaTypeSuggestsM3u8,
} from "../utils/media-format.ts";
import {
  optionalTrimmedString,
  validateRequiredString,
  validateUrl,
} from "../utils/validation.ts";

interface ProxyResponse {
  data: Uint8Array | ReadableStream<Uint8Array>;
  contentType: string;
  status: number;
  headers: Record<string, string>;
}

export function normalizeProxyUrl(value: string): string | null {
  if (validateUrl(value)) return new URL(value.trim()).href;
  try {
    const decoded = decodeURIComponent(value);
    return validateUrl(decoded) ? new URL(decoded.trim()).href : null;
  } catch {
    return null;
  }
}

export function normalizeProxyReferer(value?: string): string | undefined {
  const referer = optionalTrimmedString(value);
  return referer && validateUrl(referer) ? new URL(referer).href : undefined;
}

export function normalizeProxyBodyType(value?: string): string | undefined {
  return optionalTrimmedString(value)?.toLowerCase();
}

export function normalizeRemoteProxyMode(value?: string): string | undefined {
  return normalizeProxyBodyType(value) === "remote" ? "remote" : undefined;
}

export function normalizeRangeHeader(value?: string): string | undefined {
  const range = optionalTrimmedString(value);
  if (!range) return undefined;
  const match = /^bytes=((?:\d+-\d*|-\d+)(?:,(?:\d+-\d*|-\d+))*)$/.exec(
    range,
  );
  if (!match) return undefined;

  for (const part of match[1].split(",")) {
    const [start, end] = part.split("-", 2);
    if (start === "") {
      if (!Number.isSafeInteger(Number(end)) || Number(end) <= 0) {
        return undefined;
      }
      continue;
    }
    const startNumber = Number(start);
    if (!Number.isSafeInteger(startNumber) || startNumber < 0) {
      return undefined;
    }
    if (end !== "") {
      const endNumber = Number(end);
      if (!Number.isSafeInteger(endNumber) || endNumber < startNumber) {
        return undefined;
      }
    }
  }

  return range;
}

function originOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

export function isM3U8Request(
  url: string,
  contentType: string,
  bodyType?: string,
): boolean {
  const normalizedBodyType = normalizeProxyBodyType(bodyType);
  if (looksLikeH5Url(url)) return false;
  if (looksLikeM3u8Url(url)) return true;
  if (normalizedBodyType === "m3u8") return true;
  if (normalizedBodyType === "h5" || normalizedBodyType === "video") {
    return false;
  }
  const lowerContentType = contentType.toLowerCase();
  if (mediaTypeSuggestsM3u8(lowerContentType)) {
    return true;
  }

  return false;
}

function isRemoteProxy(proxy?: string): boolean {
  return normalizeRemoteProxyMode(proxy) === "remote";
}

function shouldTrackByteProgress(bodyType?: string): boolean {
  const normalizedType = normalizeProxyBodyType(bodyType);
  return !normalizedType || normalizedType === "h5" ||
    normalizedType === "video";
}

function contentDispositionFilename(name: string, extension: string): string {
  const fileName = name.toLowerCase().endsWith(extension)
    ? name
    : `${name}${extension}`;
  return fileName.replace(/["\r\n]/g, "_");
}

async function handleProxyRequest(
  ctx: ServerContext,
  originalUrl: string,
  referer?: string,
  taskId?: string,
  range?: string,
  bodyType?: string,
  proxy?: string,
): Promise<ProxyResponse> {
  try {
    const requestHeaders: Record<string, string> = {};

    if (range) {
      requestHeaders["Range"] = range;
    }
    if (referer) {
      requestHeaders["Referer"] = referer;
      requestHeaders["Origin"] = originOf(referer);
    }

    const response = await fetch2(originalUrl, {
      headers: requestHeaders,
      timeout: 300000,
      useProxy: isRemoteProxy(proxy),
    });

    if (!response.ok && response.status !== 206) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") ||
      "application/octet-stream";
    const responseHeaders: Record<string, string> = {};

    const contentRange = response.headers.get("content-range");
    if (contentRange) {
      responseHeaders["Content-Range"] = contentRange;
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      responseHeaders["Content-Length"] = contentLength;
    }

    if (contentType.startsWith("video/") || contentType.startsWith("audio/")) {
      responseHeaders["Accept-Ranges"] = "bytes";
    }

    if (isM3U8Request(originalUrl, contentType, bodyType)) {
      const parser = new M3U8Parser(originalUrl);
      const text = await response.text();
      const playlistType = M3U8Parser.identifyPlaylistType(text);
      const manifest = playlistType === "master"
        ? parser.parseMasterPlaylist(text)
        : parser.parseMediaPlaylist(text);

      const rewritten = M3U8Service.serializeManifest(manifest, {
        taskId,
        referer,
        proxy,
      });

      if (taskId && playlistType === "media" && manifest.segments.length > 0) {
        ctx.downloadManager.markStart(taskId, manifest.segments.length);
      }

      return {
        data: new TextEncoder().encode(rewritten),
        contentType: "application/vnd.apple.mpegurl",
        status: 200,
        headers: {},
      };
    }

    const normalizedType = normalizeProxyBodyType(bodyType);

    const parsedContentLength = contentLength ? parseInt(contentLength, 10) : 0;
    const hasKnownContentLength = Number.isFinite(parsedContentLength) &&
      parsedContentLength > 0;

    if (
      normalizedType == "ts" &&
      hasKnownContentLength &&
      parsedContentLength < 2 * 1024
    ) {
      const data = new Uint8Array(await response.arrayBuffer());
      const fixed = M3U8Service.fixTSStream(data);

      if (taskId) {
        ctx.downloadManager.markStep(taskId);
      }

      const { "Content-Length": _, ...headersWithoutLength } = responseHeaders;
      return {
        data: fixed,
        contentType: "video/mp2t",
        status: response.status,
        headers: headersWithoutLength,
      };
    }

    if (!response.body) {
      throw new Error("The response from upstream has no body");
    }

    let targetStream = response.body;
    const contentLen = parseInt(response.headers.get("content-length") || "0");
    if (taskId && (normalizedType === "segment" || normalizedType === "ts")) {
      const transform = new TransformStream<Uint8Array>({
        transform(chunk, ctrl) {
          ctrl.enqueue(chunk);
        },
        flush() {
          ctx.downloadManager.markStep(taskId);
        },
      });
      response.body.pipeTo(transform.writable).catch((error) => {
        logWarn(`代理分片流转发中断: ${originalUrl}`, error);
      });
      targetStream = transform.readable;
    } else if (taskId && contentLen && shouldTrackByteProgress(bodyType)) {
      let written = 0;
      const transform = new TransformStream<Uint8Array>({
        transform(chunk, ctrl) {
          ctrl.enqueue(chunk);
          written += chunk.byteLength;
          ctx.downloadManager.setProgress(taskId, written / contentLen);
        },
      });
      response.body.pipeTo(transform.writable).catch((error) => {
        logWarn(`代理流转发中断: ${originalUrl}`, error);
      });
      targetStream = transform.readable;
    }

    return {
      contentType,
      status: response.status,
      headers: responseHeaders,
      data: targetStream,
    };
  } catch (error) {
    logError(`Proxy request failed: ${originalUrl}`, error);
    throw error;
  }
}

export function registerProxyRoutes(app: Hono, ctx: ServerContext): void {
  app.options("/api/proxy/:name", (c) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    c.header(
      "Access-Control-Allow-Headers",
      "Range, Content-Type, Authorization",
    );
    c.header(
      "Access-Control-Expose-Headers",
      "Content-Range, Content-Length, Accept-Ranges",
    );
    c.header("Access-Control-Max-Age", "86400");
    return c.body(null, 204);
  });

  app.get("/api/proxy/:name", async (c) => {
    try {
      const encodedUrl = c.req.query("url");

      if (!validateRequiredString(encodedUrl, "url")) {
        logWarn("代理请求失败: 缺少URL参数");
        return c.json({ error: "缺少URL参数" }, 400);
      }
      const targetUrl = normalizeProxyUrl(encodedUrl!);
      if (!targetUrl) {
        logWarn("代理请求失败: URL参数无效");
        return c.json({ error: "URL参数无效" }, 400);
      }

      const rangeHeader = c.req.header("range");
      const normalizedRange = normalizeRangeHeader(rangeHeader);
      if (rangeHeader && !normalizedRange) {
        logWarn(`忽略无效 Range 请求头: ${rangeHeader}`);
      }
      logDebug(
        `处理代理请求: ${targetUrl}, Range: ${normalizedRange || "none"}`,
      );

      const taskId = optionalTrimmedString(c.req.query("taskId"));
      const referer = normalizeProxyReferer(c.req.query("referer"));
      const bodyType = normalizeProxyBodyType(c.req.query("type"));
      const proxyMode = normalizeRemoteProxyMode(c.req.query("proxy"));
      const { data, contentType, status, headers } = await handleProxyRequest(
        ctx,
        targetUrl,
        referer ?? undefined,
        taskId ?? undefined,
        normalizedRange ?? undefined,
        bodyType ?? undefined,
        proxyMode ?? undefined,
      );

      logDebug(`代理请求成功，内容类型: ${contentType}, 状态: ${status}`);

      c.header("Access-Control-Allow-Origin", "*");
      c.header("Access-Control-Allow-Headers", "Range, Content-Type");
      c.header(
        "Access-Control-Expose-Headers",
        "Content-Range, Content-Length, Accept-Ranges",
      );
      c.header("Cache-Control", "max-age=3600");

      for (const [key, value] of Object.entries(headers)) {
        c.header(key, value);
      }

      if (
        contentType.startsWith("video/") || contentType.startsWith("audio/")
      ) {
        c.header("Accept-Ranges", "bytes");
      }

      if (
        c.req.query("download") === "true" &&
        c.req.param("name") &&
        isM3U8Request(targetUrl, contentType, bodyType)
      ) {
        const fileName = contentDispositionFilename(
          c.req.param("name"),
          ".m3u8",
        );
        c.header(
          "Content-Disposition",
          `attachment; filename="${fileName}"`,
        );
      }

      c.status(status as 200 | 206);
      return c.body(data as Uint8Array<ArrayBuffer>);
    } catch (error) {
      logError("处理代理请求失败:", error);
      return c.json({ error: "处理代理请求失败" }, 500);
    }
  });

  app.get("/api/image-proxy", async (c) => {
    try {
      const imageUrl = normalizeProxyUrl(c.req.query("url") ?? "");
      const sourceId = optionalTrimmedString(c.req.query("source"));

      if (!imageUrl) {
        logWarn("图片代理失败: 缺少或无效的图片URL");
        return c.json({ error: "缺少或无效的图片URL" }, 400);
      }

      logDebug(`图片代理请求: ${imageUrl}, sourceId: ${sourceId}`);

      if (sourceId) {
        const source = ctx.videoSourceManager.getSource(sourceId);
        if (source) {
          logDebug(`使用源 ${sourceId} 获取图片`);
          const imageData = await source.getImage(imageUrl);
          const error = imagePayloadError(
            imageData.data,
            imageData.contentType,
          );
          if (error) {
            logWarn(
              `图片代理源返回无效图片: ${imageUrl}, sourceId=${sourceId}, ${error}`,
            );
            return c.json({ error }, 502);
          }
          c.header("Content-Type", imageData.contentType);
          c.header("Access-Control-Allow-Origin", "*");
          c.header("Cache-Control", "max-age=3600");
          return c.body(imageData.data as Uint8Array<ArrayBuffer>);
        }
      }

      logDebug("使用默认方式获取图片");
      const proxiedImage = await fetch2(imageUrl);
      if (!proxiedImage.ok) {
        logWarn(`图片代理上游失败: ${imageUrl}, status=${proxiedImage.status}`);
        return c.json(
          { error: `图片请求失败: HTTP ${proxiedImage.status}` },
          502,
        );
      }
      const imageBuffer = new Uint8Array(await proxiedImage.arrayBuffer());
      const contentType = proxiedImage.headers.get("content-type") ||
        "image/jpeg";
      const error = imagePayloadError(imageBuffer, contentType);
      if (error) {
        logWarn(
          `图片代理上游返回无效图片: ${imageUrl}, content-type=${contentType}, ${error}`,
        );
        return c.json({ error }, 502);
      }
      c.header(
        "Content-Type",
        contentType,
      );
      c.header("Access-Control-Allow-Origin", "*");
      c.header("Cache-Control", "max-age=3600");
      return c.body(imageBuffer);
    } catch (error) {
      logError("图片代理失败:", error);
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        500,
      );
    }
  });
}
