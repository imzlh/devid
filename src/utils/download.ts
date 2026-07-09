import {
  IDownloadTask,
  IDownloadTaskPersisted,
  URLProxy,
} from "../types/index.ts";
import { logDebug, logError, logInfo, logWarn } from "./logger.ts";
import { getConfig } from "../config/index.ts";
import { inferMediaFormat } from "./media-format.ts";
import { validateUrl } from "./validation.ts";
import { basename, extname, join, normalize } from "node:path";
import { mergeReadableStreams } from "@std/streams";

// 清理间隔固定值
const TASK_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5分钟
const BUILTIN_DEFAULT_OUTPUT_PATH = "./downloads";

// 下载统计
interface DownloadStats {
  totalBytesDownloaded: number;
  totalFilesDownloaded: number;
  failedDownloads: number;
  cancelledDownloads: number;
}

interface DownloadManagerOptions {
  serverAddr?: string;
  autoProcess?: boolean;
}

// 延迟函数
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const DOWNLOAD_STATUSES = new Set<IDownloadTask["status"]>([
  "pending",
  "downloading",
  "completed",
  "error",
  "cancelled",
]);

// 格式化字节
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function validDateOrNow(value: string | Date | undefined): Date {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function optionalValidDate(value: string | Date | undefined): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function normalizeProgress(value: unknown): number {
  const progress = typeof value === "number" ? value : Number(value);
  return Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;
}

function normalizeNonNegativeInteger(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizePositiveInteger(
  value: unknown,
  fallback?: number,
): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  return fallback && fallback > 0 ? fallback : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function normalizePersistedFormat(
  value: unknown,
  url: string,
): IDownloadTask["format"] {
  return inferMediaFormat(
    url,
    typeof value === "string" ? value : undefined,
  );
}

function normalizePersistedProxy(value: unknown): IDownloadTask["proxy"] {
  return value === URLProxy.NONE || value === URLProxy.LOCAL ||
      value === URLProxy.REMOTE
    ? value
    : undefined;
}

function normalizeTaskFormat(
  value: unknown,
  url: string,
): IDownloadTask["format"] {
  return inferMediaFormat(
    url,
    typeof value === "string" ? value : undefined,
  );
}

function normalizeTaskProxy(value: unknown): IDownloadTask["proxy"] {
  return value === URLProxy.NONE || value === URLProxy.LOCAL ||
      value === URLProxy.REMOTE
    ? value
    : undefined;
}

function normalizeOptionalHttpUrl(value: unknown): string | undefined {
  if (!validateUrl(value)) return undefined;
  return new URL((value as string).trim()).href;
}

function nonEmptyStringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function validateRequiredTaskId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeTaskId(value: unknown): string | undefined {
  return validateRequiredTaskId(value) ? value.trim() : undefined;
}

export function splitDownloadFileName(fileName: string): {
  base: string;
  extension: string;
} {
  const extension = extname(fileName);
  if (!extension || extension === fileName) {
    return { base: fileName || "unnamed", extension: "" };
  }
  const base = fileName.slice(0, -extension.length) || "unnamed";
  return { base, extension };
}

export function taskFilePathMatchesOutput(
  task: Pick<IDownloadTask, "outputPath" | "fileName" | "filePath">,
): boolean {
  if (!task.outputPath || !task.fileName || !task.filePath) return false;
  return normalize(task.filePath) ===
    normalize(join(task.outputPath, task.fileName));
}

function removeTaskFileSync(task: IDownloadTask): boolean {
  if (!task.filePath) return false;
  if (!taskFilePathMatchesOutput(task)) {
    logWarn(
      `跳过删除异常任务文件路径: task=${task.id}, filePath=${task.filePath}`,
    );
    return false;
  }
  Deno.removeSync(task.filePath);
  return true;
}

// 带超时的 Promise
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string,
  signal?: AbortSignal,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(`${operationName} 已取消`));
      return;
    }

    let abortHandler: (() => void) | null = null;
    let settled = false;
    let timedOut = false;
    let cleanupGraceId: ReturnType<typeof setTimeout> | null = null;
    const timeoutError = new Error(`${operationName} 超时(${timeoutMs}ms)`);

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (cleanupGraceId) clearTimeout(cleanupGraceId);
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
      fn();
    };

    const timeoutId = setTimeout(() => {
      timedOut = true;
      try {
        onTimeout?.();
      } catch (error) {
        logWarn(`${operationName} 超时回调失败`, error);
      }
      cleanupGraceId = setTimeout(() => {
        settle(() => reject(timeoutError));
      }, 5000);
    }, timeoutMs);

    // 监听外部取消信号
    if (signal) {
      abortHandler = () => {
        if (timedOut) return;
        settle(() => reject(new Error(`${operationName} 已取消`)));
      };
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    promise
      .then((result) => {
        settle(() => timedOut ? reject(timeoutError) : resolve(result));
      })
      .catch((error) => {
        settle(() => reject(timedOut ? timeoutError : error));
      });
  });
}

export class DownloadManager {
  private downloadTasks = new Map<string, IDownloadTask>();
  private activeDownloads = new Map<string, AbortController>();
  private downloadQueue: string[] = []; // 等待下载的队列
  private stats: DownloadStats = {
    totalBytesDownloaded: 0,
    totalFilesDownloaded: 0,
    failedDownloads: 0,
    cancelledDownloads: 0,
  };
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private taskIdCounter = 0;
  private serverAddr: string;
  private autoProcess: boolean;

  constructor(options: DownloadManagerOptions = {}) {
    this.serverAddr = options.serverAddr ??
      `http://localhost:${getConfig().server.port}`;
    this.autoProcess = options.autoProcess ?? true;
    // 启动定期清理
    this.startCleanupTimer();
    logInfo("下载管理器已初始化");
  }

  // ==================== 任务创建 ====================

  /**
   * 创建下载任务（带安全检查）
   */
  createDownloadTask(
    url: string,
    title: string,
    outputPath: string = getConfig().download.defaultOutputPath,
    referer?: string,
    media?: Pick<IDownloadTask, "format" | "proxy">,
  ): string {
    if (!validateUrl(url)) {
      throw new Error(`无效的下载URL: ${url}`);
    }
    const normalizedUrl = new URL(url.trim()).href;
    const normalizedReferer = normalizeOptionalHttpUrl(referer);

    const normalizedTitle = nonEmptyStringOr(title, "未命名下载");
    const taskId = `dl_${Date.now()}_${++this.taskIdCounter}`;
    const safeTitle = this.sanitizeFileName(normalizedTitle);
    const fileName = `${safeTitle}.mp4`;

    // 清理路径
    const safeOutputPath = this.sanitizePath(outputPath);
    const filePath = `${safeOutputPath}/${fileName}`;

    const task: IDownloadTask = {
      id: taskId,
      url: normalizedUrl,
      format: normalizeTaskFormat(media?.format, normalizedUrl),
      proxy: normalizeTaskProxy(media?.proxy),
      title: normalizedTitle,
      outputPath: safeOutputPath,
      filePath,
      fileName,
      status: "pending",
      progress: 0,
      createTime: new Date(),
      referer: normalizedReferer,
      retryCount: 0,
      maxRetries: getConfig().download.retryAttempts,
    };

    this.downloadTasks.set(taskId, task);

    logInfo(`创建下载任务: ${taskId}, 标题: ${title}, 路径: ${safeOutputPath}`);

    return taskId;
  }

  /**
   * 清理文件名，移除非法字符
   */
  private sanitizeFileName(name: string): string {
    if (!name || typeof name !== "string") {
      return "unnamed";
    }

    return name
      .replace(/[\\/:*?"<>|]/g, "_") // 替换Windows非法字符
      // deno-lint-ignore no-control-regex
      .replace(/[\x00-\x1f\x7f]/g, "") // 移除控制字符
      .replace(/\s+/g, " ") // 合并连续空格
      .replace(/\.+/g, ".") // 合并连续句点
      .replace(/^\.+/, "") // 移除开头的句点
      .trim() // 移除首尾空格
      .substring(0, 200) || "unnamed"; // 限制长度，确保非空
  }

  /**
   * 清理路径，防止目录遍历攻击
   */
  private sanitizePath(path: unknown): string {
    const defaultPath = this.safeOutputPathOrBuiltin(
      getConfig().download.defaultOutputPath,
    );
    if (!path || typeof path !== "string") {
      return defaultPath;
    }

    const normalized = this.normalizeOutputPath(path);
    if (!normalized) {
      logWarn(`检测到不安全路径: ${path}，使用默认路径`);
      return defaultPath;
    }

    return normalized;
  }

  private safeOutputPathOrBuiltin(path: unknown): string {
    return this.normalizeOutputPath(path) ?? BUILTIN_DEFAULT_OUTPUT_PATH;
  }

  private normalizeOutputPath(path: unknown): string | undefined {
    if (typeof path !== "string") return undefined;
    const normalized = path.trim().replace(/\/+$/, "");
    if (!normalized) return undefined;
    if (
      normalized.includes("..") ||
      /^https?:\/\//i.test(normalized) ||
      /^[a-z][a-z0-9+.-]*:/i.test(normalized) ||
      normalized.includes("\\")
    ) {
      return undefined;
    }
    return normalized;
  }

  // ==================== 下载控制 ====================

  /**
   * 处理下载队列
   */
  private processQueue(): void {
    // 检查并发限制
    const maxConcurrent = getConfig().download.maxConcurrent;
    if (this.activeDownloads.size >= maxConcurrent) {
      logDebug(`并发下载数已达上限(${maxConcurrent})，任务进入队列等待`);
      return;
    }

    // 获取下一个待下载任务
    while (
      this.downloadQueue.length > 0 && this.activeDownloads.size < maxConcurrent
    ) {
      const taskId = this.downloadQueue.shift();
      if (!taskId) continue;

      const task = this.downloadTasks.get(taskId);
      if (!task || task.status !== "pending") continue;

      // 开始下载（不等待，让队列继续处理）
      this.startDownloadInternal(taskId).catch((error) => {
        logError(`启动下载任务失败 ${taskId}:`, error);
      });
    }
  }

  /**
   * 开始下载（内部实现）
   */
  private async startDownloadInternal(taskId: string): Promise<boolean> {
    const task = this.downloadTasks.get(taskId);
    if (!task) {
      logError(`下载任务不存在: ${taskId}`);
      return false;
    }

    if (task.status === "downloading") {
      logWarn(`下载任务已在下载中: ${taskId}`);
      return false;
    }

    // 创建 AbortController
    const controller = new AbortController();
    this.activeDownloads.set(taskId, controller);

    task.status = "downloading";
    task.startTime = new Date();
    task.endTime = undefined;
    task.error = undefined;

    logInfo(`开始下载任务: ${taskId}, 标题: ${task.title}`);

    try {
      // 确保输出目录存在
      await this.ensureDirectoryExists(task.outputPath);

      // 检查磁盘空间
      const hasSpace = await this.checkDiskSpace(task.outputPath);
      if (!hasSpace) {
        task.status = "error";
        const minDisk = getConfig().download.minDiskFreeMB;
        task.error = `磁盘空间不足，需要至少 ${minDisk}MB 可用空间`;
        task.endTime = new Date();
        this.stats.failedDownloads++;
        logError(task.error);
        return false;
      }

      // 执行下载（带超时）
      const success = await withTimeout(
        this.downloadVideoWithFFmpeg(task, controller.signal),
        getConfig().download.timeoutMs,
        `下载任务 ${taskId}`,
        controller.signal,
        () => controller.abort(),
      );

      if (success) {
        task.status = "completed";
        task.progress = 100;
        task.endTime = new Date();
        this.stats.totalFilesDownloaded++;
        logInfo(`下载完成: ${task.title} -> ${task.filePath}`);
      } else {
        throw new Error("下载返回失败状态");
      }

      return success;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // 检查是否已取消（使用类型断言绕过TypeScript检查）
      if ((task.status as string) === "cancelled") {
        task.endTime = new Date();
        logInfo(`下载任务已取消: ${taskId}`);
        return false;
      }

      // 检查是否需要重试
      const maxRetries = getConfig().download.retryAttempts;
      if ((task.retryCount || 0) < (task.maxRetries || maxRetries)) {
        task.retryCount = (task.retryCount || 0) + 1;
        task.status = "pending";
        task.progress = 0;
        logWarn(
          `下载失败，准备重试 (${task.retryCount}/${task.maxRetries}): ${errorMsg}`,
        );

        await delay(getConfig().download.retryDelayMs);
        this.downloadQueue.unshift(taskId); // 放回队列头部优先重试
        this.processQueue();
        return false;
      }

      // 最终失败
      task.status = "error";
      task.error = errorMsg;
      task.endTime = new Date();
      this.stats.failedDownloads++;
      logError(`下载最终失败: ${task.title}`, error);
      return false;
    } finally {
      this.activeDownloads.delete(taskId);
      // 处理队列中的下一个任务
      this.processQueue();
    }
  }

  /**
   * 公共API：开始下载（添加到队列）
   */
  startDownload(taskId: string): boolean {
    const normalizedTaskId = normalizeTaskId(taskId);
    if (!normalizedTaskId) {
      logError(`开始下载失败: 任务ID无效 ${String(taskId)}`);
      return false;
    }

    const task = this.downloadTasks.get(normalizedTaskId);
    if (!task) {
      logError(`开始下载失败: 任务不存在 ${normalizedTaskId}`);
      return false;
    }

    if (task.status === "downloading") {
      logWarn(`任务已在下载中: ${normalizedTaskId}`);
      return true;
    }

    if (task.status === "completed") {
      logWarn(`任务已下载完成: ${normalizedTaskId}`);
      return true;
    }

    // 重置状态并加入队列
    if (task.status === "error" || task.status === "cancelled") {
      task.progress = 0;
      task.error = undefined;
      task.endTime = undefined;
    }
    task.status = "pending";
    task.retryCount = 0;

    if (!this.downloadQueue.includes(normalizedTaskId)) {
      this.downloadQueue.push(normalizedTaskId);
    }

    if (this.autoProcess) {
      this.processQueue();
    }
    return true;
  }

  /**
   * 下载视频（使用FFmpeg）
   */
  private async downloadVideoWithFFmpeg(
    task: IDownloadTask,
    signal: AbortSignal,
  ): Promise<boolean> {
    let logPath: string | undefined;
    let command: Deno.ChildProcess | undefined;
    let abortHandler: (() => void) | undefined;
    let cleanupOutput = false;
    let completedSuccessfully = false;
    try {
      // 检查文件是否已存在
      try {
        await Deno.stat(task.filePath);
        // 文件存在，添加序号
        const { base, extension } = splitDownloadFileName(task.fileName);
        let counter = 1;
        let newPath = task.filePath;

        while (true) {
          newPath = `${task.outputPath}/${base}_${counter}${extension}`;
          try {
            await Deno.stat(newPath);
            counter++;
          } catch (error) {
            if (error instanceof Deno.errors.NotFound) {
              break;
            }
            throw error;
          }
        }

        task.filePath = newPath;
        task.fileName = `${base}_${counter}${extension}`;
        logInfo(`文件已存在，重命名为: ${task.fileName}`);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          throw error;
        }
        // 文件不存在，继续
      }

      // 构建代理URL
      const proxyName = task.format === "m3u8" ? "playlist.m3u8" : "video.mp4";
      const proxyUrl = new URL(`${this.serverAddr}/api/proxy/${proxyName}`);
      proxyUrl.searchParams.set("taskId", task.id);
      proxyUrl.searchParams.set("url", task.url);
      proxyUrl.searchParams.set(
        "referer",
        task.referer ?? new URL(task.url).origin,
      );
      if (task.format === "m3u8") {
        proxyUrl.searchParams.set("type", "m3u8");
      } else if (task.format === "h5") {
        proxyUrl.searchParams.set("type", "h5");
      }
      if (task.proxy === URLProxy.REMOTE) {
        proxyUrl.searchParams.set("proxy", "remote");
      }

      logDebug(`FFmpeg 输入: ${proxyUrl.toString()}`);
      logDebug(`FFmpeg 输出: ${task.filePath}`);

      const ffmpegArgs = [
        "-hide_banner",
        "-stats",
        "-i",
        proxyUrl.toString(),
        "-c",
        "copy",
      ];
      if (task.format === "m3u8") {
        ffmpegArgs.push("-bsf:a", "aac_adtstoasc");
      }
      ffmpegArgs.push(
        "-movflags",
        "+faststart",
        "-y",
        task.filePath,
      );

      // 启动 FFmpeg
      command = new Deno.Command("ffmpeg", {
        args: ffmpegArgs,
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      cleanupOutput = true;

      // 监听取消信号
      abortHandler = () => {
        try {
          command?.kill("SIGTERM");
          // 给2秒优雅关闭时间，然后强制结束
          setTimeout(() => {
            try {
              command?.kill("SIGKILL");
            } catch {
              // 可能已退出
            }
          }, 2000);
        } catch {
          // 进程可能已结束
        }
      };
      signal.addEventListener("abort", abortHandler, { once: true });

      // 等待 FFmpeg 完成
      await this.ensureDirectoryExists(getConfig().server.dataDir);
      logPath = join(
        getConfig().server.dataDir,
        basename(task.filePath) + ".log",
      );
      const file = await Deno.open(logPath, {
        write: true,
        create: true,
        read: false,
      });
      await mergeReadableStreams(command.stdout, command.stderr).pipeTo(
        file.writable,
      );
      const status = await command.status;

      // 清理监听器
      signal.removeEventListener("abort", abortHandler);

      if (!status.success) {
        throw new Error(`FFmpeg 退出码 ${status.code}，详细日志见 ${logPath}`);
      }
      completedSuccessfully = true;

      // 获取文件大小
      try {
        const fileInfo = await Deno.stat(task.filePath);
        this.stats.totalBytesDownloaded += fileInfo.size;
        logInfo(
          `下载完成: ${task.fileName}, 大小: ${formatBytes(fileInfo.size)}`,
        );
      } catch {
        // 忽略统计错误
      }

      return true;
    } catch (error) {
      try {
        command?.kill("SIGTERM");
      } catch {
        // 进程可能已退出
      }
      if (cleanupOutput) {
        // 清理不完整文件
        try {
          await Deno.remove(task.filePath);
        } catch {
          // 忽略清理错误
        }
      }
      throw error;
    } finally {
      if (abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
      if (logPath && completedSuccessfully) {
        try {
          await Deno.remove(logPath);
        } catch {
          // 日志清理失败不应改变下载结果
        }
      }
    }
  }

  /**
   * 检查磁盘空间
   */
  private async checkDiskSpace(path: string): Promise<boolean> {
    try {
      // 简单实现：检查目录是否可写
      const testFile = `${path}/.disk_check_${Date.now()}`;
      await Deno.writeTextFile(testFile, "");
      await Deno.remove(testFile);
      return true;
    } catch (error) {
      logError(`磁盘空间检查失败: ${path}`, error);
      return false;
    }
  }

  /**
   * 确保目录存在
   */
  private async ensureDirectoryExists(path: string): Promise<void> {
    try {
      await Deno.stat(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        await Deno.mkdir(path, { recursive: true });
        logDebug(`创建目录: ${path}`);
      } else {
        throw error;
      }
    }
  }

  // ==================== 任务管理 ====================

  /**
   * 取消下载
   */
  cancelDownload(taskId: string): boolean {
    const normalizedTaskId = normalizeTaskId(taskId);
    if (!normalizedTaskId) {
      return false;
    }

    const task = this.downloadTasks.get(normalizedTaskId);
    if (!task) {
      return false;
    }

    if (task.status === "cancelled") {
      return true;
    }

    if (task.status !== "pending" && task.status !== "downloading") {
      logWarn(`任务当前状态不可取消: ${taskId}, status=${task.status}`);
      return false;
    }

    // 如果正在下载，触发 AbortController
    const controller = this.activeDownloads.get(normalizedTaskId);
    if (controller) {
      controller.abort();
      this.activeDownloads.delete(normalizedTaskId);
    }

    // 从队列中移除
    const queueIndex = this.downloadQueue.indexOf(normalizedTaskId);
    if (queueIndex > -1) {
      this.downloadQueue.splice(queueIndex, 1);
    }

    // 更新任务状态
    task.status = "cancelled";
    task.error = "下载已取消";
    task.endTime = new Date();
    this.stats.cancelledDownloads++;

    // 清理临时文件
    this.cleanupTempFiles(normalizedTaskId);

    logInfo(`下载任务已取消: ${normalizedTaskId}`);
    return true;
  }

  /**
   * 重试下载
   */
  retryDownload(taskId: string): boolean {
    const normalizedTaskId = normalizeTaskId(taskId);
    if (!normalizedTaskId) {
      logError(`重试失败: 任务ID无效 ${String(taskId)}`);
      return false;
    }

    const task = this.downloadTasks.get(normalizedTaskId);
    if (!task) {
      logError(`重试失败: 任务不存在 ${normalizedTaskId}`);
      return false;
    }

    if (task.status === "downloading" || task.status === "completed") {
      logWarn(
        `任务当前状态不可重试: ${normalizedTaskId}, status=${task.status}`,
      );
      return false;
    }

    // 重置任务状态
    task.status = "pending";
    task.progress = 0;
    task.error = undefined;
    task.retryCount = 0;
    task.startTime = undefined;
    task.endTime = undefined;

    logInfo(`重试下载任务: ${normalizedTaskId}`);
    return this.startDownload(normalizedTaskId);
  }

  /**
   * 删除下载任务
   */
  deleteDownload(taskId: string, deleteFile: boolean = false): boolean {
    const normalizedTaskId = normalizeTaskId(taskId);
    if (!normalizedTaskId) {
      return false;
    }

    const task = this.downloadTasks.get(normalizedTaskId);
    if (!task) {
      return false;
    }

    // 如果正在下载，先取消
    if (task.status === "downloading") {
      this.cancelDownload(normalizedTaskId);
    }

    // 从队列中移除
    const queueIndex = this.downloadQueue.indexOf(normalizedTaskId);
    if (queueIndex > -1) {
      this.downloadQueue.splice(queueIndex, 1);
    }

    // 删除文件
    if (deleteFile && task.filePath) {
      try {
        const deleted = removeTaskFileSync(task);
        if (deleted) {
          logInfo(`删除文件: ${task.filePath}`);
        }
      } catch (error) {
        logWarn(`删除文件失败: ${task.filePath}`, error);
      }
    }

    // 删除任务
    this.downloadTasks.delete(normalizedTaskId);
    logInfo(`删除下载任务: ${normalizedTaskId}`);
    return true;
  }

  /**
   * 清除已完成/已取消的任务
   */
  clearCompletedDownloads(
    deleteFiles: boolean = false,
  ): { count: number; deletedFiles: number } {
    const toDelete: string[] = [];
    let deletedFiles = 0;

    for (const [taskId, task] of this.downloadTasks) {
      if (
        task.status === "completed" || task.status === "cancelled" ||
        task.status === "error"
      ) {
        toDelete.push(taskId);

        if (deleteFiles && task.filePath) {
          try {
            if (removeTaskFileSync(task)) {
              deletedFiles++;
            }
          } catch {
            // 忽略删除错误
          }
        }
      }
    }

    for (const taskId of toDelete) {
      this.downloadTasks.delete(taskId);
    }

    logInfo(`清除任务: ${toDelete.length} 个，删除文件: ${deletedFiles} 个`);
    return { count: toDelete.length, deletedFiles };
  }

  /**
   * 清理旧任务（定期调用）
   */
  private cleanupOldTasks(): void {
    const now = Date.now();
    const maxAgeMs = getConfig().download.taskMaxAgeHours * 60 * 60 * 1000;
    const toDelete: string[] = [];

    for (const [taskId, task] of this.downloadTasks) {
      const taskAge = now - task.createTime.getTime();

      // 删除超过最大保留时间的已完成/已取消/错误任务
      if (
        taskAge > maxAgeMs &&
        (task.status === "completed" || task.status === "cancelled" ||
          task.status === "error")
      ) {
        toDelete.push(taskId);
      }
    }

    for (const taskId of toDelete) {
      this.downloadTasks.delete(taskId);
    }

    if (toDelete.length > 0) {
      logDebug(`清理 ${toDelete.length} 个过期任务`);
    }
  }

  /**
   * 启动清理定时器
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldTasks();
    }, TASK_CLEANUP_INTERVAL_MS);
  }

  /**
   * 停止清理定时器
   */
  stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 清理临时文件
   */
  private async cleanupTempFiles(taskId: string): Promise<void> {
    const tempDirs = [
      `./temp/${taskId}`,
      `./downloads/.temp/${taskId}`,
    ];

    for (const dir of tempDirs) {
      try {
        await Deno.remove(dir, { recursive: true });
        logDebug(`清理临时目录: ${dir}`);
      } catch {
        // 忽略错误
      }
    }
  }

  // ==================== 查询接口 ====================

  getDownloadTask(taskId: string): IDownloadTask | undefined {
    const normalizedTaskId = normalizeTaskId(taskId);
    return normalizedTaskId
      ? this.downloadTasks.get(normalizedTaskId)
      : undefined;
  }

  getAllDownloadTasks(): IDownloadTask[] {
    return Array.from(this.downloadTasks.values());
  }

  getActiveDownloads(): IDownloadTask[] {
    return Array.from(this.downloadTasks.values())
      .filter((t) => t.status === "downloading");
  }

  getPendingDownloads(): IDownloadTask[] {
    return Array.from(this.downloadTasks.values())
      .filter((t) => t.status === "pending");
  }

  getStats(): DownloadStats {
    return { ...this.stats };
  }

  getQueuePosition(taskId: string): number {
    const normalizedTaskId = normalizeTaskId(taskId);
    return normalizedTaskId
      ? this.downloadQueue.indexOf(normalizedTaskId) + 1
      : 0;
  }

  // ==================== 进度标记（供代理使用） ====================

  markStart(taskId: string, allSegments: number): void {
    const normalizedTaskId = normalizeTaskId(taskId);
    const task = normalizedTaskId
      ? this.downloadTasks.get(normalizedTaskId)
      : undefined;
    if (task && Number.isFinite(allSegments) && allSegments > 0) {
      task.totalSegments = Math.floor(allSegments);
      if (task.status === "pending") {
        task.status = "downloading";
      }
      logDebug(`任务 ${normalizedTaskId} 开始下载，共 ${allSegments} 个片段`);
    }
  }

  markStep(taskId: string): IDownloadTask | undefined {
    const normalizedTaskId = normalizeTaskId(taskId);
    const task = normalizedTaskId
      ? this.downloadTasks.get(normalizedTaskId)
      : undefined;
    if (task && task.totalSegments && task.totalSegments > 0) {
      const segPercent = 100 / task.totalSegments;
      task.progress = Math.min(99, task.progress + segPercent);
    }
    return task;
  }

  setProgress(taskId: string, progress: number): IDownloadTask | undefined {
    const normalizedTaskId = normalizeTaskId(taskId);
    const task = normalizedTaskId
      ? this.downloadTasks.get(normalizedTaskId)
      : undefined;
    if (task) {
      if (!Number.isFinite(progress)) return task;
      const percent = progress <= 1 ? progress * 100 : progress;
      task.progress = Math.max(0, Math.min(99, percent));
    }
    return task;
  }

  // ==================== 持久化 (Deno KV) ====================

  private kvKey = "download_tasks";

  /**
   * 导出任务到持久化格式
   */
  exportTasks(): IDownloadTaskPersisted[] {
    return Array.from(this.downloadTasks.values()).map((task) => ({
      id: task.id,
      url: task.url,
      referer: task.referer,
      format: task.format,
      proxy: task.proxy,
      queued: this.downloadQueue.includes(task.id),
      title: task.title,
      outputPath: task.outputPath,
      filePath: task.filePath,
      fileName: task.fileName,
      status: task.status,
      progress: task.progress,
      createTime: task.createTime.toISOString(),
      startTime: task.startTime?.toISOString(),
      endTime: task.endTime?.toISOString(),
      error: task.error,
      totalSegments: task.totalSegments,
      retryCount: task.retryCount,
      maxRetries: task.maxRetries,
    }));
  }

  /**
   * 从持久化格式导入任务
   */
  importTasks(tasks: unknown): void {
    if (!Array.isArray(tasks)) {
      logWarn("跳过无效持久化下载任务列表");
      return;
    }

    let imported = 0;
    for (const persisted of tasks) {
      const taskLike = persisted && typeof persisted === "object"
        ? persisted as Partial<IDownloadTaskPersisted>
        : null;
      const rawUrl = taskLike?.url;
      if (
        !taskLike ||
        !validateRequiredTaskId(taskLike.id) ||
        typeof rawUrl !== "string" ||
        !validateUrl(rawUrl)
      ) {
        logWarn(`跳过无效持久化下载任务: ${taskLike?.id ?? "unknown"}`);
        continue;
      }
      const taskId = taskLike.id.trim();
      if (this.downloadTasks.has(taskId)) {
        logWarn(`跳过重复持久化下载任务: ${taskId}`);
        continue;
      }
      const normalizedUrl = new URL(rawUrl.trim()).href;
      const persistedStatus = DOWNLOAD_STATUSES.has(
          taskLike.status as IDownloadTask["status"],
        )
        ? taskLike.status as IDownloadTask["status"]
        : "error";
      const maxRetries = normalizePositiveInteger(
        taskLike.maxRetries,
        getConfig().download.retryAttempts,
      );
      const title = nonEmptyStringOr(taskLike.title, "未命名下载");
      const outputPath = this.sanitizePath(taskLike.outputPath);
      const fileName = nonEmptyStringOr(
        taskLike.fileName,
        `${this.sanitizeFileName(title)}.mp4`,
      );
      const safeFileName = this.sanitizeFileName(fileName);

      const task: IDownloadTask = {
        ...taskLike,
        id: taskId,
        url: normalizedUrl,
        referer: normalizeOptionalHttpUrl(taskLike.referer),
        format: normalizePersistedFormat(taskLike.format, normalizedUrl),
        proxy: normalizePersistedProxy(taskLike.proxy),
        title,
        outputPath,
        fileName: safeFileName,
        filePath: `${outputPath}/${safeFileName}`,
        createTime: validDateOrNow(taskLike.createTime),
        startTime: optionalValidDate(taskLike.startTime),
        endTime: optionalValidDate(taskLike.endTime),
        status: persistedStatus === "downloading" ? "error" : persistedStatus, // 重置进行中的任务
        error: persistedStatus === "downloading"
          ? "程序重启，任务中断"
          : normalizeOptionalString(taskLike.error),
        progress: persistedStatus === "downloading"
          ? 0
          : normalizeProgress(taskLike.progress),
        totalSegments: normalizePositiveInteger(taskLike.totalSegments),
        retryCount: normalizeNonNegativeInteger(taskLike.retryCount),
        maxRetries,
      };

      this.downloadTasks.set(task.id, task);
      imported++;

      // 只恢复已经排队的等待任务；单纯创建但未启动的 pending 不应重启后自动下载。
      if (task.status === "pending" && taskLike.queued === true) {
        this.downloadQueue.push(task.id);
      }
    }

    logInfo(`导入 ${imported}/${tasks.length} 个下载任务`);
    if (this.autoProcess) {
      this.processQueue();
    }
  }

  /**
   * 保存任务到 Deno KV
   */
  async saveToKV(): Promise<void> {
    let kv: Deno.Kv | undefined;
    try {
      kv = await Deno.openKv();
      const tasks = this.exportTasks();
      await kv.set([this.kvKey], tasks);
      logDebug(`保存 ${tasks.length} 个下载任务到 KV`);
    } catch (error) {
      logError("保存下载任务到 KV 失败:", error);
    } finally {
      kv?.close();
    }
  }

  /**
   * 从 Deno KV 加载任务
   */
  async loadFromKV(): Promise<void> {
    let kv: Deno.Kv | undefined;
    try {
      kv = await Deno.openKv();
      const result = await kv.get<IDownloadTaskPersisted[]>([this.kvKey]);

      if (Array.isArray(result.value)) {
        this.importTasks(result.value);
        logInfo(`从 KV 加载 ${result.value.length} 个下载任务`);
      } else if (result.value !== null) {
        logWarn("KV 中的下载任务数据不是数组，已跳过");
      }
    } catch (error) {
      logError("从 KV 加载下载任务失败:", error);
    } finally {
      kv?.close();
    }
  }

  /**
   * 保存任务到文件 (向下兼容)
   * @deprecated 使用 saveToKV 代替
   */
  saveToFile(_filePath: string): Promise<void> {
    return this.saveToKV();
  }

  /**
   * 从文件加载任务 (向下兼容)
   * @deprecated 使用 loadFromKV 代替
   */
  loadFromFile(_filePath: string): Promise<void> {
    return this.loadFromKV();
  }
}
