import type { Hono } from "hono";
import type { ServerContext } from "./context.ts";
import { M3U8Parser, M3U8Service } from "../utils/m3u8.ts";
import { fetch2 } from "../utils/fetch.ts";
import { logDebug, logError, logWarn } from "../utils/logger.ts";
import { validateRequiredString, validateUrl } from "../utils/validation.ts";

interface ProxyResponse {
  data: Uint8Array | ReadableStream<Uint8Array>;
  contentType: string;
  status: number;
  headers: Record<string, string>;
}

async function handleProxyRequest(
  ctx: ServerContext,
  encodedUrl: string,
  referer?: string,
  taskId?: string,
  range?: string,
  bodyType?: string,
  proxy?: string,
): Promise<ProxyResponse> {
  try {
    const originalUrl = decodeURIComponent(encodedUrl);
    const requestHeaders: Record<string, string> = {
      "Referer": referer || "",
      "Origin": referer ? new URL(referer).origin : "",
    };

    if (range) {
      requestHeaders["Range"] = range;
    }

    const response = await fetch2(originalUrl, {
      headers: requestHeaders,
      timeout: 300000,
      useProxy: proxy == "remote",
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

    if (
      originalUrl.includes(".m3u8") ||
      contentType.includes("application/vnd.apple.mpegurl") ||
      bodyType == "m3u8"
    ) {
      const parser = new M3U8Parser(originalUrl);
      const text = await response.text();
      const manifest = M3U8Parser.identifyPlaylistType(text) === "master"
        ? parser.parseMasterPlaylist(text)
        : parser.parseMediaPlaylist(text);

      const rewritten = M3U8Service.serializeManifest(manifest, {
        taskId,
        referer,
        proxy,
      });

      if (taskId) {
        ctx.downloadManager.markStart(taskId, manifest.segments.length);
      }

      return {
        data: new TextEncoder().encode(rewritten),
        contentType: "application/vnd.apple.mpegurl",
        status: 200,
        headers: {},
      };
    }

    if (
      bodyType == "ts" && (parseInt(contentLength ?? "0") < 2 * 1024 || taskId)
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
    if (taskId && contentLen) {
      let written = 0;
      const transform = new TransformStream<Uint8Array>({
        transform(chunk, ctrl) {
          ctrl.enqueue(chunk);
          written += chunk.byteLength;
          ctx.downloadManager.setProgress(taskId, written / contentLen);
        },
      });
      response.body.pipeTo(transform.writable);
      targetStream = transform.readable;
    }

    return {
      contentType,
      status: response.status,
      headers: responseHeaders,
      data: targetStream,
    };
  } catch (error) {
    logError(`Proxy request failed: ${encodedUrl}`, error);
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

      const rangeHeader = c.req.header("range");
      logDebug(`处理代理请求: ${encodedUrl}, Range: ${rangeHeader || "none"}`);

      const taskId = c.req.query("taskId");
      const referer = c.req.query("referer");
      const { data, contentType, status, headers } = await handleProxyRequest(
        ctx,
        encodedUrl!,
        referer ?? undefined,
        taskId ?? undefined,
        rangeHeader ?? undefined,
        c.req.query("type") ?? undefined,
        c.req.query("proxy") ?? undefined,
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
        c.req.param("name") &&
        (contentType.includes("mpegurl") || encodedUrl!.includes(".m3u8"))
      ) {
        c.header(
          "Content-Disposition",
          `attachment; filename="${c.req.param("name")}.m3u8"`,
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
      const imageUrl = c.req.query("url");
      const sourceId = c.req.query("source");

      if (!imageUrl || !validateUrl(imageUrl)) {
        logWarn("图片代理失败: 缺少或无效的图片URL");
        return c.json({ error: "缺少或无效的图片URL" }, 400);
      }

      logDebug(`图片代理请求: ${imageUrl}, sourceId: ${sourceId}`);

      if (sourceId) {
        const source = ctx.videoSourceManager.getSource(sourceId);
        if (source) {
          logDebug(`使用源 ${sourceId} 获取图片`);
          const imageData = await source.getImage(imageUrl);
          c.header("Content-Type", imageData.contentType);
          return c.body(imageData.data as Uint8Array<ArrayBuffer>);
        }
      }

      logDebug("使用默认方式获取图片");
      const proxiedImage = await fetch2(imageUrl);
      const imageBuffer = new Uint8Array(await proxiedImage.arrayBuffer());
      c.header(
        "Content-Type",
        proxiedImage.headers.get("content-type") || "image/jpeg",
      );
      c.header("Access-Control-Allow-Origin", "*");
      c.header("Cache-Control", "max-age=3600");
      return c.body(imageBuffer);
    } catch (error) {
      logError("图片代理失败:", error);
      return c.json(
        { error: error instanceof Error ? error.message : error },
        500,
      );
    }
  });
}
