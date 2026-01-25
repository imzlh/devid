import { DownloadTask } from '../types/index.ts';
import { logError, logInfo, logDebug } from "./logger.ts";
import { SERVER_ADDR } from "../server.ts";

/**
 * 下载管理器
 */
export class DownloadManager {
    private downloadTasks = new Map<string, DownloadTask>();
    private activeDownloads = new Map<string, AbortController>();

    markStep(taskId: string) {
        const task = this.downloadTasks.get(taskId);
        if (task && task.totalSegments) {
            // 监控进度
            const segPercent = 100 / task.totalSegments;
            const oldProgress = task.progress;
            task.progress = oldProgress + segPercent;
        }
    }

    markStart(taskId: string, allSegments: number) {
        const task = this.downloadTasks.get(taskId);
        if (task) {
            task.totalSegments = allSegments;
            task.status = 'downloading';
        }
    }

    /**
     * 创建下载任务（修复路径安全问题）
     */
    createDownloadTask(url: string, title: string, outputPath: string = './downloads', referer?: string): string {
        const taskId = crypto.randomUUID();

        const safeTitle = this.sanitizeFileName(title);
        const fileName = `${safeTitle}.mp4`;
        
        // 如果outputPath看起来像URL（以http开头），则使用默认路径
        const safeOutputPath = outputPath && !outputPath.startsWith('http') 
            ? outputPath 
            : './downloads';
            
        const filePath = `${safeOutputPath}/${fileName}`;

        const task: DownloadTask = {
            id: taskId,
            url,
            title,
            outputPath: safeOutputPath,
            filePath,
            fileName,
            status: 'pending',
            progress: 0,
            createTime: new Date(),
            referer
        };

        this.downloadTasks.set(taskId, task);
        logDebug(`创建下载任务: ${taskId}, 文件名: ${fileName}, 输出路径: ${safeOutputPath}`);
        return taskId;
    }

    /**
     * 清理文件名，移除非法字符
     */
    private sanitizeFileName(name: string): string {
        // Windows不允许的字符: \ / : * ? " < > |
        // 同时移除连续的空格和句点
        return name
            .replace(/[\\/:*?"<>|]/g, '_')  // 替换非法字符
            .replace(/\s+/g, ' ')           // 合并连续空格
            .replace(/\.+/g, '.')           // 合并连续句点
            .replace(/^\.+/, '')            // 移除开头的句点
            .trim()                         // 移除首尾空格
            .substring(0, 200);             // 限制长度防止路径过长
    }

    // 开始下载
    async startDownload(taskId: string): Promise<boolean> {
        logInfo(`开始下载任务: ${taskId}`);
        if (!taskId) {
            logError('下载任务ID不能为空');
            return false;
        }

        const task = this.downloadTasks.get(taskId);
        if (!task) {
            logError(`下载任务不存在: ${taskId}, 当前任务数量: ${this.downloadTasks.size}`);
            logDebug(`所有任务ID: ${Array.from(this.downloadTasks.keys()).join(', ')}`);
            return false;
        }

        if (this.activeDownloads.has(taskId)) {
            logError(`下载任务已在下载中: ${taskId}`);
            return false;
        }

        if (task.status !== 'pending' && task.status !== 'error') {
            logError(`下载任务状态不允许开始: ${taskId}, 状态: ${task.status}`);
            return false;
        }

        task.status = 'downloading';
        task.startTime = new Date();

        // 修复2：创建AbortController用于取消下载
        const controller = new AbortController();
        this.activeDownloads.set(taskId, controller);

        try {
            // 确保输出目录存在
            await this.ensureDirectoryExists(task.outputPath);

            // 只处理M3U8下载
            logInfo(`开始下载M3U8视频: ${task.title}`);

            // 修复3：使用新的下载策略，完全基于Deno进度
            const success = await this.downloadM3U8Video(task, controller.signal);

            if (success) {
                task.status = 'completed';
                task.progress = 100;
                task.endTime = new Date();
                logInfo(`下载完成: ${task.title}`);
            } else {
                task.status = 'error';
                task.error = 'M3U8视频下载失败';
                logError(`下载失败: ${task.title}`);
            }

            return success;
        } catch (error) {
            task.status = 'error';
            task.error = error instanceof Error ? error.message : String(error);
            logError(`下载失败: ${task.title}`, error);
            return false;
        } finally {
            this.activeDownloads.delete(taskId);
        }
    }

    /**
     * 修复4：新的M3U8下载策略，进度完全基于Deno下载
     */
    private async downloadM3U8Video(task: DownloadTask, signal: AbortSignal): Promise<boolean> {
        try {
            logInfo('使用FFmpeg直接下载视频...');
            
            // 修复：确保文件路径是绝对路径且格式正确
            const absoluteFilePath = Deno.realPathSync(Deno.cwd()) + '/' + task.filePath.replace(/^\.\//, '');
            
            const command = new Deno.Command('ffmpeg', {
                args: [
                    '-i', SERVER_ADDR + '/api/proxy/playlist.m3u8?taskId=' + task.id 
                        + '&url=' + encodeURIComponent(task.url) 
                        + '&referer=' + encodeURIComponent(task.referer ?? new URL(task.url).origin),
                    '-c', 'copy',
                    '-y',
                    absoluteFilePath  // 使用绝对路径
                ],
                stdin: 'null',
                stdout: 'inherit',
                stderr: 'inherit'
            }).spawn();

            signal.addEventListener('abort', () => {
                command.kill();
            });

            await command.output();
            task.progress = 100; // 下载完成
            return true;
        } catch (error) {
            logError(`M3U8下载失败:`, error);
            return false;
        }
    }

    /**
     * 获取下载任务
     */
    getDownloadTask(taskId: string): DownloadTask | undefined {
        return this.downloadTasks.get(taskId);
    }

    /**
     * 获取所有下载任务
     */
    getAllDownloadTasks(): DownloadTask[] {
        return Array.from(this.downloadTasks.values());
    }

    /**
     * 取消下载（修复：使用AbortController）
     */
    cancelDownload(taskId: string): boolean {
        const task = this.downloadTasks.get(taskId);
        if (!task) {
            return false;
        }

        // 触发AbortController
        const controller = this.activeDownloads.get(taskId);
        if (controller) {
            controller.abort();
            this.activeDownloads.delete(taskId);
        }

        // 更新任务状态 - 修复：使用cancelled而不是error
        task.status = 'cancelled';
        task.error = '下载已取消';

        // 清理临时文件
        const tempDir = `./temp/${taskId}`;
        this.cleanupTempFiles(tempDir).catch(err =>
            logError(`清理临时文件失败: ${tempDir}`, err)
        );

        return true;
    }

    /**
     * 重试下载
     */
    async retryDownload(taskId: string): Promise<boolean> {
        const task = this.downloadTasks.get(taskId);
        if (!task) {
            return false;
        }

        // 重置任务状态
        task.status = 'pending';
        task.progress = 0;
        task.error = undefined;
        task.startTime = undefined;
        task.endTime = undefined;

        // 重新开始下载
        return await this.startDownload(taskId);
    }

    /**
     * 清除已完成下载
     */
    clearCompletedDownloads(): boolean {
        const completedTaskIds: string[] = [];
        
        // 收集已完成的任务ID
        for (const [taskId, task] of this.downloadTasks.entries()) {
            if (task.status === 'completed' || task.status === 'cancelled') {
                completedTaskIds.push(taskId);
            }
        }
        
        // 删除已完成的任务
        let removedCount = 0;
        for (const taskId of completedTaskIds) {
            if (this.downloadTasks.delete(taskId)) {
                removedCount++;
            }
        }
        
        logInfo(`清除已完成下载任务: ${removedCount} 个任务被删除`);
        return removedCount > 0;
    }

    /**
     * 确保目录存在
     */
    private async ensureDirectoryExists(path: string): Promise<void> {
        try {
            // 修复：确保路径是绝对路径
            const absolutePath = path.startsWith('.') 
                ? Deno.realPathSync(Deno.cwd()) + '/' + path.replace(/^\.\//, '')
                : path;
                
            await Deno.stat(absolutePath);
            logDebug(`目录已存在: ${absolutePath}`);
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) {
                // 确保使用绝对路径创建目录
                const absolutePath = path.startsWith('.') 
                    ? Deno.realPathSync(Deno.cwd()) + '/' + path.replace(/^\.\//, '')
                    : path;
                    
                await Deno.mkdir(absolutePath, { recursive: true });
                logDebug(`创建目录: ${absolutePath}`);
            } else {
                throw error;
            }
        }
    }

    /**
     * 清理临时文件
     */
    private async cleanupTempFiles(tempDir: string): Promise<void> {
        try {
            await Deno.remove(tempDir, { recursive: true });
            logDebug(`清理临时文件: ${tempDir}`);
        } catch (error) {
            logError(`清理临时文件失败: ${tempDir}`, error);
        }
    }

    /**
     * 格式化字节数
     */
    private formatBytes(bytes: number): string {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }
}