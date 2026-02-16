import { IDownloadTask, IDownloadTaskPersisted } from '../types/index.ts';
import { logError, logInfo, logDebug, logWarn } from "./logger.ts";
import { SERVER_ADDR } from "../server.ts";
import { getConfig } from "../config/index.ts";

// 清理间隔固定值
const TASK_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;  // 5分钟

// 下载统计
interface DownloadStats {
    totalBytesDownloaded: number;
    totalFilesDownloaded: number;
    failedDownloads: number;
    cancelledDownloads: number;
}

// 延迟函数
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 格式化字节
function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

// 带超时的 Promise
async function withTimeout<T>(
    promise: Promise<T>, 
    timeoutMs: number, 
    operationName: string,
    signal?: AbortSignal
): Promise<T> {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error(`${operationName} 超时(${timeoutMs}ms)`));
        }, timeoutMs);

        // 监听外部取消信号
        if (signal) {
            signal.addEventListener('abort', () => {
                clearTimeout(timeoutId);
                reject(new Error(`${operationName} 已取消`));
            }, { once: true });
        }

        promise
            .then(result => {
                clearTimeout(timeoutId);
                resolve(result);
            })
            .catch(error => {
                clearTimeout(timeoutId);
                reject(error);
            });
    });
}

export class DownloadManager {
    private downloadTasks = new Map<string, IDownloadTask>();
    private activeDownloads = new Map<string, AbortController>();
    private downloadQueue: string[] = [];  // 等待下载的队列
    private stats: DownloadStats = {
        totalBytesDownloaded: 0,
        totalFilesDownloaded: 0,
        failedDownloads: 0,
        cancelledDownloads: 0
    };
    private cleanupTimer: number | null = null;
    private taskIdCounter = 0;

    constructor() {
        // 启动定期清理
        this.startCleanupTimer();
        logInfo('下载管理器已初始化');
    }

    // ==================== 任务创建 ====================

    /**
     * 创建下载任务（带安全检查）
     */
    createDownloadTask(
        url: string, 
        title: string, 
        outputPath: string = './downloads', 
        referer?: string
    ): string {
        // 验证URL
        try {
            new URL(url);
        } catch {
            throw new Error(`无效的下载URL: ${url}`);
        }

        const taskId = `dl_${Date.now()}_${++this.taskIdCounter}`;
        const safeTitle = this.sanitizeFileName(title);
        const fileName = `${safeTitle}.mp4`;
        
        // 清理路径
        const safeOutputPath = this.sanitizePath(outputPath);
        const filePath = `${safeOutputPath}/${fileName}`;

        const task: IDownloadTask = {
            id: taskId,
            url,
            title,
            outputPath: safeOutputPath,
            filePath,
            fileName,
            status: 'pending',
            progress: 0,
            createTime: new Date(),
            referer,
            retryCount: 0,
            maxRetries: getConfig().download.retryAttempts
        };

        this.downloadTasks.set(taskId, task);
        this.downloadQueue.push(taskId);
        
        logInfo(`创建下载任务: ${taskId}, 标题: ${title}, 路径: ${safeOutputPath}`);
        
        // 尝试开始下载（如果有空位）
        this.processQueue();
        
        return taskId;
    }

    /**
     * 清理文件名，移除非法字符
     */
    private sanitizeFileName(name: string): string {
        if (!name || typeof name !== 'string') {
            return 'unnamed';
        }
        
        return name
            .replace(/[\\/:*?"<>|]/g, '_')   // 替换Windows非法字符
            .replace(/[\x00-\x1f\x7f]/g, '')  // 移除控制字符
            .replace(/\s+/g, ' ')             // 合并连续空格
            .replace(/\.+/g, '.')             // 合并连续句点
            .replace(/^\.+/, '')              // 移除开头的句点
            .trim()                           // 移除首尾空格
            .substring(0, 200) || 'unnamed';  // 限制长度，确保非空
    }

    /**
     * 清理路径，防止目录遍历攻击
     */
    private sanitizePath(path: string): string {
        if (!path || typeof path !== 'string') {
            return './downloads';
        }
        
        // 如果路径包含 .. 或以 http 开头，使用默认路径
        if (path.includes('..') || path.startsWith('http')) {
            logWarn(`检测到不安全路径: ${path}，使用默认路径`);
            return './downloads';
        }
        
        return path.replace(/\/+$/, '') || './downloads';  // 移除末尾斜杠
    }

    // ==================== 下载控制 ====================

    /**
     * 处理下载队列
     */
    private async processQueue(): Promise<void> {
        // 检查并发限制
        const maxConcurrent = getConfig().download.maxConcurrent;
        if (this.activeDownloads.size >= maxConcurrent) {
            logDebug(`并发下载数已达上限(${maxConcurrent})，任务进入队列等待`);
            return;
        }

        // 获取下一个待下载任务
        while (this.downloadQueue.length > 0 && this.activeDownloads.size < maxConcurrent) {
            const taskId = this.downloadQueue.shift();
            if (!taskId) continue;

            const task = this.downloadTasks.get(taskId);
            if (!task || task.status !== 'pending') continue;

            // 开始下载（不等待，让队列继续处理）
            this.startDownloadInternal(taskId).catch(error => {
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

        if (task.status === 'downloading') {
            logWarn(`下载任务已在下载中: ${taskId}`);
            return false;
        }

        // 检查磁盘空间
        const hasSpace = await this.checkDiskSpace(task.outputPath);
        if (!hasSpace) {
            task.status = 'error';
            const minDisk = getConfig().download.minDiskFreeMB;
            task.error = `磁盘空间不足，需要至少 ${minDisk}MB 可用空间`;
            logError(task.error);
            return false;
        }

        // 创建 AbortController
        const controller = new AbortController();
        this.activeDownloads.set(taskId, controller);

        task.status = 'downloading';
        task.startTime = new Date();
        task.error = undefined;

        logInfo(`开始下载任务: ${taskId}, 标题: ${task.title}`);

        try {
            // 确保输出目录存在
            await this.ensureDirectoryExists(task.outputPath);

            // 执行下载（带超时）
            const success = await withTimeout(
                this.downloadM3U8Video(task, controller.signal),
                getConfig().download.timeoutMs,
                `下载任务 ${taskId}`,
                controller.signal
            );

            if (success) {
                task.status = 'completed';
                task.progress = 100;
                task.endTime = new Date();
                this.stats.totalFilesDownloaded++;
                logInfo(`下载完成: ${task.title} -> ${task.filePath}`);
            } else {
                throw new Error('下载返回失败状态');
            }

            return success;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            
            // 检查是否已取消（使用类型断言绕过TypeScript检查）
            if ((task.status as string) === 'cancelled') {
                logInfo(`下载任务已取消: ${taskId}`);
                return false;
            }

            // 检查是否需要重试
            const maxRetries = getConfig().download.retryAttempts;
            if ((task.retryCount || 0) < (task.maxRetries || maxRetries)) {
                task.retryCount = (task.retryCount || 0) + 1;
                task.status = 'pending';
                task.progress = 0;
                logWarn(`下载失败，准备重试 (${task.retryCount}/${task.maxRetries}): ${errorMsg}`);
                
                await delay(getConfig().download.retryDelayMs);
                this.downloadQueue.unshift(taskId);  // 放回队列头部优先重试
                this.processQueue();
                return false;
            }

            // 最终失败
            task.status = 'error';
            task.error = errorMsg;
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
    async startDownload(taskId: string): Promise<boolean> {
        const task = this.downloadTasks.get(taskId);
        if (!task) {
            logError(`开始下载失败: 任务不存在 ${taskId}`);
            return false;
        }

        if (task.status === 'downloading') {
            logWarn(`任务已在下载中: ${taskId}`);
            return true;
        }

        if (task.status === 'completed') {
            logWarn(`任务已下载完成: ${taskId}`);
            return true;
        }

        // 重置状态并加入队列
        task.status = 'pending';
        task.retryCount = 0;
        
        if (!this.downloadQueue.includes(taskId)) {
            this.downloadQueue.push(taskId);
        }

        this.processQueue();
        return true;
    }

    /**
     * 下载M3U8视频（使用FFmpeg）
     */
    private async downloadM3U8Video(task: IDownloadTask, signal: AbortSignal): Promise<boolean> {
        try {
            // 检查文件是否已存在
            try {
                await Deno.stat(task.filePath);
                // 文件存在，添加序号
                const ext = task.fileName.slice(-4);
                const base = task.fileName.slice(0, -4);
                let counter = 1;
                let newPath = task.filePath;
                
                while (true) {
                    newPath = `${task.outputPath}/${base}_${counter}${ext}`;
                    try {
                        await Deno.stat(newPath);
                        counter++;
                    } catch {
                        break;
                    }
                }
                
                task.filePath = newPath;
                task.fileName = `${base}_${counter}${ext}`;
                logInfo(`文件已存在，重命名为: ${task.fileName}`);
            } catch {
                // 文件不存在，继续
            }

            // 构建代理URL
            const proxyUrl = new URL(`${SERVER_ADDR}/api/proxy/playlist.m3u8`);
            proxyUrl.searchParams.set('taskId', task.id);
            proxyUrl.searchParams.set('url', task.url);
            proxyUrl.searchParams.set('referer', task.referer ?? new URL(task.url).origin);

            logDebug(`FFmpeg 输入: ${proxyUrl.toString()}`);
            logDebug(`FFmpeg 输出: ${task.filePath}`);

            // 启动 FFmpeg
            const command = new Deno.Command('ffmpeg', {
                args: [
                    '-hide_banner',           // 隐藏版本信息
                    '-loglevel', 'error',     // 只显示错误
                    '-stats',                 // 显示进度统计
                    '-i', proxyUrl.toString(),
                    '-c', 'copy',             // 直接复制，不重新编码
                    '-bsf:a', 'aac_adtstoasc', // 修复 AAC 音频
                    '-movflags', '+faststart', // 优化网络播放
                    '-y',                     // 覆盖已存在文件
                    task.filePath
                ],
                stdin: 'null',
                stdout: 'piped',
                stderr: 'piped'
            }).spawn();

            // 监听取消信号
            const abortHandler = () => {
                try {
                    command.kill('SIGTERM');
                    // 给2秒优雅关闭时间，然后强制结束
                    setTimeout(() => {
                        try {
                            command.kill('SIGKILL');
                        } catch {
                            // 可能已退出
                        }
                    }, 2000);
                } catch {
                    // 进程可能已结束
                }
            };
            signal.addEventListener('abort', abortHandler, { once: true });

            // 等待 FFmpeg 完成
            const output = await command.output();
            
            // 清理监听器
            signal.removeEventListener('abort', abortHandler);

            if (!output.success) {
                const stderr = new TextDecoder().decode(output.stderr);
                throw new Error(`FFmpeg 退出码 ${output.code}: ${stderr.slice(0, 500)}`);
            }

            // 获取文件大小
            try {
                const fileInfo = await Deno.stat(task.filePath);
                this.stats.totalBytesDownloaded += fileInfo.size;
                logInfo(`下载完成: ${task.fileName}, 大小: ${formatBytes(fileInfo.size)}`);
            } catch {
                // 忽略统计错误
            }

            return true;
        } catch (error) {
            // 清理不完整文件
            try {
                await Deno.remove(task.filePath);
            } catch {
                // 忽略清理错误
            }
            throw error;
        }
    }

    /**
     * 检查磁盘空间
     */
    private async checkDiskSpace(path: string): Promise<boolean> {
        try {
            // 简单实现：检查目录是否可写
            const testFile = `${path}/.disk_check_${Date.now()}`;
            await Deno.writeTextFile(testFile, '');
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
        const task = this.downloadTasks.get(taskId);
        if (!task) {
            return false;
        }

        // 如果正在下载，触发 AbortController
        const controller = this.activeDownloads.get(taskId);
        if (controller) {
            controller.abort();
            this.activeDownloads.delete(taskId);
        }

        // 从队列中移除
        const queueIndex = this.downloadQueue.indexOf(taskId);
        if (queueIndex > -1) {
            this.downloadQueue.splice(queueIndex, 1);
        }

        // 更新任务状态
        task.status = 'cancelled';
        task.error = '下载已取消';
        this.stats.cancelledDownloads++;

        // 清理临时文件
        this.cleanupTempFiles(taskId);

        logInfo(`下载任务已取消: ${taskId}`);
        return true;
    }

    /**
     * 重试下载
     */
    async retryDownload(taskId: string): Promise<boolean> {
        const task = this.downloadTasks.get(taskId);
        if (!task) {
            logError(`重试失败: 任务不存在 ${taskId}`);
            return false;
        }

        // 重置任务状态
        task.status = 'pending';
        task.progress = 0;
        task.error = undefined;
        task.retryCount = 0;
        task.startTime = undefined;
        task.endTime = undefined;

        logInfo(`重试下载任务: ${taskId}`);
        return this.startDownload(taskId);
    }

    /**
     * 删除下载任务
     */
    deleteDownload(taskId: string, deleteFile: boolean = false): boolean {
        const task = this.downloadTasks.get(taskId);
        if (!task) {
            return false;
        }

        // 如果正在下载，先取消
        if (task.status === 'downloading') {
            this.cancelDownload(taskId);
        }

        // 从队列中移除
        const queueIndex = this.downloadQueue.indexOf(taskId);
        if (queueIndex > -1) {
            this.downloadQueue.splice(queueIndex, 1);
        }

        // 删除文件
        if (deleteFile && task.filePath) {
            try {
                Deno.removeSync(task.filePath);
                logInfo(`删除文件: ${task.filePath}`);
            } catch (error) {
                logWarn(`删除文件失败: ${task.filePath}`, error);
            }
        }

        // 删除任务
        this.downloadTasks.delete(taskId);
        logInfo(`删除下载任务: ${taskId}`);
        return true;
    }

    /**
     * 清除已完成/已取消的任务
     */
    clearCompletedDownloads(deleteFiles: boolean = false): { count: number; deletedFiles: number } {
        const toDelete: string[] = [];
        let deletedFiles = 0;

        for (const [taskId, task] of this.downloadTasks) {
            if (task.status === 'completed' || task.status === 'cancelled' || task.status === 'error') {
                toDelete.push(taskId);
                
                if (deleteFiles && task.filePath) {
                    try {
                        Deno.removeSync(task.filePath);
                        deletedFiles++;
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
            if (taskAge > maxAgeMs && 
                (task.status === 'completed' || task.status === 'cancelled' || task.status === 'error')) {
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
            `./downloads/.temp/${taskId}`
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
        return this.downloadTasks.get(taskId);
    }

    getAllDownloadTasks(): IDownloadTask[] {
        return Array.from(this.downloadTasks.values());
    }

    getActiveDownloads(): IDownloadTask[] {
        return Array.from(this.downloadTasks.values())
            .filter(t => t.status === 'downloading');
    }

    getPendingDownloads(): IDownloadTask[] {
        return Array.from(this.downloadTasks.values())
            .filter(t => t.status === 'pending');
    }

    getStats(): DownloadStats {
        return { ...this.stats };
    }

    getQueuePosition(taskId: string): number {
        return this.downloadQueue.indexOf(taskId) + 1;
    }

    // ==================== 进度标记（供代理使用） ====================

    markStart(taskId: string, allSegments: number): void {
        const task = this.downloadTasks.get(taskId);
        if (task) {
            task.totalSegments = allSegments;
            if (task.status === 'pending') {
                task.status = 'downloading';
            }
            logDebug(`任务 ${taskId} 开始下载，共 ${allSegments} 个片段`);
        }
    }

    markStep(taskId: string): IDownloadTask | undefined {
        const task = this.downloadTasks.get(taskId);
        if (task && task.totalSegments && task.totalSegments > 0) {
            const segPercent = 100 / task.totalSegments;
            task.progress = Math.min(99, task.progress + segPercent);
        }
        return task;
    }

    setProgress(taskId: string, progress: number): IDownloadTask | undefined {
        const task = this.downloadTasks.get(taskId);
        if (task) task.progress = progress;
        return task;
    }

    // ==================== 持久化 (Deno KV) ====================

    private kvKey = 'download_tasks';

    /**
     * 导出任务到持久化格式
     */
    exportTasks(): IDownloadTaskPersisted[] {
        return Array.from(this.downloadTasks.values()).map(task => ({
            id: task.id,
            url: task.url,
            referer: task.referer,
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
            maxRetries: task.maxRetries
        }));
    }

    /**
     * 从持久化格式导入任务
     */
    importTasks(tasks: IDownloadTaskPersisted[]): void {
        for (const persisted of tasks) {
            // 只恢复未完成的任务
            if (persisted.status === 'completed' || persisted.status === 'cancelled') {
                continue;
            }

            const task: IDownloadTask = {
                ...persisted,
                createTime: new Date(persisted.createTime),
                startTime: persisted.startTime ? new Date(persisted.startTime) : undefined,
                endTime: persisted.endTime ? new Date(persisted.endTime) : undefined,
                status: persisted.status === 'downloading' ? 'error' : persisted.status, // 重置进行中的任务
                error: persisted.status === 'downloading' ? '程序重启，任务中断' : persisted.error,
                progress: persisted.status === 'downloading' ? 0 : persisted.progress
            };

            this.downloadTasks.set(task.id, task);
            
            // 将待处理任务加入队列
            if (task.status === 'pending') {
                this.downloadQueue.push(task.id);
            }
        }

        logInfo(`导入 ${tasks.length} 个下载任务`);
        this.processQueue();
    }

    /**
     * 保存任务到 Deno KV
     */
    async saveToKV(): Promise<void> {
        try {
            const kv = await Deno.openKv();
            const tasks = this.exportTasks();
            await kv.set([this.kvKey], tasks);
            kv.close();
            logDebug(`保存 ${tasks.length} 个下载任务到 KV`);
        } catch (error) {
            logError('保存下载任务到 KV 失败:', error);
        }
    }

    /**
     * 从 Deno KV 加载任务
     */
    async loadFromKV(): Promise<void> {
        try {
            const kv = await Deno.openKv();
            const result = await kv.get<IDownloadTaskPersisted[]>([this.kvKey]);
            kv.close();
            
            if (result.value) {
                this.importTasks(result.value);
                logInfo(`从 KV 加载 ${result.value.length} 个下载任务`);
            }
        } catch (error) {
            logError('从 KV 加载下载任务失败:', error);
        }
    }

    /**
     * 保存任务到文件 (向下兼容)
     * @deprecated 使用 saveToKV 代替
     */
    async saveToFile(_filePath: string): Promise<void> {
        return this.saveToKV();
    }

    /**
     * 从文件加载任务 (向下兼容)
     * @deprecated 使用 loadFromKV 代替
     */
    async loadFromFile(_filePath: string): Promise<void> {
        return this.loadFromKV();
    }
}
