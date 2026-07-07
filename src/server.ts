import { createApp } from "./server/app.ts";
import { VideoSourceManager } from "./manager.ts";
import { DownloadManager } from "./utils/download.ts";
import {
  enableVerboseLogs,
  logError,
  logInfo,
  logWarn,
} from "./utils/logger.ts";
import { createDefaultConfig, getConfig } from "./config/index.ts";
import { rpcServer } from "./websocket/rpc.ts";
import {
  pushDownloadComplete,
  pushDownloadError,
  pushDownloadUpdate,
} from "./websocket/push.ts";

await createDefaultConfig();
const config = getConfig();
const port = config.server.port;
export const SERVER_ADDR = `http://localhost:${port}`;

if (config.server.verboseLogging) {
  enableVerboseLogs();
  logInfo("Verbose logging enabled");
}

const videoSourceManager = new VideoSourceManager();
const downloadManager = new DownloadManager({ serverAddr: SERVER_ADDR });
const serverStartedAt = Date.now();
let lastDownloadSnapshot = "";
const lastDownloadStatuses = new Map<string, string>();
const app = createApp({
  videoSourceManager,
  downloadManager,
  rpcServer,
});

try {
  await downloadManager.loadFromKV();
  for (const task of downloadManager.getAllDownloadTasks()) {
    lastDownloadStatuses.set(task.id, task.status);
  }
} catch (error) {
  logWarn("加载持久化下载任务失败:", error);
}

logInfo("开始初始化视频源...");
try {
  await videoSourceManager.initAllSources();
  logInfo("视频源初始化完成");
} catch (error) {
  logError("视频源初始化失败:", error);
}

setInterval(async () => {
  try {
    await downloadManager.saveToKV();
  } catch (error) {
    logError("保存下载任务失败:", error);
  }
}, 30000);

setInterval(() => {
  const tasks = downloadManager.getAllDownloadTasks();
  const snapshot = JSON.stringify(tasks);
  if (snapshot !== lastDownloadSnapshot) {
    pushDownloadUpdate(tasks);
    lastDownloadSnapshot = snapshot;
  }

  const currentIds = new Set<string>();
  for (const task of tasks) {
    currentIds.add(task.id);
    const previous = lastDownloadStatuses.get(task.id);
    const isNewRuntimeTask = !previous &&
      task.createTime.getTime() >= serverStartedAt;
    if ((previous && previous !== task.status) || isNewRuntimeTask) {
      if (task.status === "completed") {
        pushDownloadComplete(task);
      } else if (task.status === "error") {
        pushDownloadError(task.id, task.error || "下载任务失败");
      }
    }
    lastDownloadStatuses.set(task.id, task.status);
  }
  for (const taskId of lastDownloadStatuses.keys()) {
    if (!currentIds.has(taskId)) {
      lastDownloadStatuses.delete(taskId);
    }
  }
}, 2000);

const gracefulShutdown = async () => {
  logInfo("正在关闭服务器...");
  videoSourceManager.stopHealthCheck();

  try {
    await downloadManager.saveToKV();
    logInfo("下载任务已保存");
  } catch (error) {
    logError("保存下载任务失败:", error);
  }

  downloadManager.stopCleanupTimer();
  logInfo("服务器已关闭");
  Deno.exit(0);
};

Deno.addSignalListener("SIGINT", gracefulShutdown);

logInfo(`服务器启动在 http://localhost:${port}`);
logInfo(`HTTP API: http://localhost:${port}/api`);
logInfo(`WebSocket: ws://localhost:${port}/ws`);

if (config.server.verboseLogging) {
  logInfo(
    "Verbose logging is enabled. Set verboseLogging=false in config.json to disable.",
  );
}

Deno.serve({ port }, app.fetch);
