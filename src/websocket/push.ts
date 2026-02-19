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
    SOURCE_HEALTH = "source:health"
}

/**
 * 推送下载状态更新
 */
export function pushDownloadUpdate(tasks: unknown[]): void {
    logDebug(`推送下载状态更新: ${tasks.length} 个任务`);
    rpcServer.broadcast(PushMessageType.DOWNLOAD_UPDATE, tasks);
}

/**
 * 推送下载完成通知
 */
export function pushDownloadComplete(task: unknown): void {
    logDebug(`推送下载完成: ${(task as { id: string }).id}`);
    rpcServer.broadcast(PushMessageType.DOWNLOAD_COMPLETE, task);
}

/**
 * 推送下载错误通知
 */
export function pushDownloadError(taskId: string, error: string): void {
    logDebug(`推送下载错误: ${taskId}`);
    rpcServer.broadcast(PushMessageType.DOWNLOAD_ERROR, { taskId, error });
}

/**
 * 推送源切换通知
 */
export function pushSourceChange(sourceId: string, sourceName: string): void {
    logDebug(`推送源切换: ${sourceId}`);
    rpcServer.broadcast(PushMessageType.SOURCE_CHANGE, { sourceId, sourceName });
}

/**
 * 推送源健康状态更新
 */
export function pushSourceHealth(health: unknown): void {
    logDebug("推送源健康状态更新");
    rpcServer.broadcast(PushMessageType.SOURCE_HEALTH, health);
}
