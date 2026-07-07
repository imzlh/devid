/**
 * WebSocket 推送服务
 * 用于主动推送下载状态和源状态更新
 */

import { rpcServer } from "./rpc.ts";
import { logDebug } from "../utils/logger.ts";

// 推送消息类型
export enum PushMessageType {
  DOWNLOAD_UPDATE = "download:update",
  DOWNLOAD_COMPLETE = "download:complete",
  DOWNLOAD_ERROR = "download:error",
  SOURCE_CHANGE = "source:change",
  SOURCE_HEALTH = "source:health",
}

export function pushedTaskId(task: unknown): string {
  if (!task || typeof task !== "object") return "unknown";
  const id = (task as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id.trim() : "unknown";
}

export function normalizePushTasks(tasks: unknown): unknown[] {
  return Array.isArray(tasks) ? tasks : [];
}

function pushedString(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/**
 * 推送下载状态更新
 */
export function pushDownloadUpdate(tasks: unknown): void {
  const normalizedTasks = normalizePushTasks(tasks);
  logDebug(`推送下载状态更新: ${normalizedTasks.length} 个任务`);
  rpcServer.broadcast(PushMessageType.DOWNLOAD_UPDATE, normalizedTasks);
}

/**
 * 推送下载完成通知
 */
export function pushDownloadComplete(task: unknown): void {
  logDebug(`推送下载完成: ${pushedTaskId(task)}`);
  rpcServer.broadcast(PushMessageType.DOWNLOAD_COMPLETE, task);
}

/**
 * 推送下载错误通知
 */
export function pushDownloadError(taskId: string, error: string): void {
  const normalizedTaskId = pushedString(taskId);
  const normalizedError = pushedString(error, "未知错误");
  logDebug(`推送下载错误: ${normalizedTaskId}`);
  rpcServer.broadcast(PushMessageType.DOWNLOAD_ERROR, {
    taskId: normalizedTaskId,
    error: normalizedError,
  });
}

/**
 * 推送源切换通知
 */
export function pushSourceChange(sourceId: string, sourceName: string): void {
  const normalizedSourceId = pushedString(sourceId);
  const normalizedSourceName = pushedString(sourceName, normalizedSourceId);
  logDebug(`推送源切换: ${normalizedSourceId}`);
  rpcServer.broadcast(PushMessageType.SOURCE_CHANGE, {
    sourceId: normalizedSourceId,
    sourceName: normalizedSourceName,
  });
}

/**
 * 推送源健康状态更新
 */
export function pushSourceHealth(health: unknown): void {
  logDebug("推送源健康状态更新");
  rpcServer.broadcast(PushMessageType.SOURCE_HEALTH, health);
}
