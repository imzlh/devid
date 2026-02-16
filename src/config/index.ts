/**
 * 统一配置管理模块
 * 
 * 优先级（从高到低）：
 * 1. 环境变量 (DV_前缀)
 * 2. 配置文件 (config.json)
 * 3. 默认值
 */

import { logInfo, logWarn, logError } from "../utils/logger.ts";

// ==================== 配置类型定义 ====================

export interface ServerConfig {
    port: number;
    verboseLogging: boolean;
    dataDir: string;
}

export interface VideoSourceConfig {
    initTimeoutMs: number;
    initRetryAttempts: number;
    initRetryDelayMs: number;
    healthCheckIntervalMs: number;
    circuitBreakerThreshold: number;
    circuitBreakerResetMs: number;
}

export interface DownloadConfig {
    timeoutMs: number;
    maxConcurrent: number;
    minDiskFreeMB: number;
    retryAttempts: number;
    retryDelayMs: number;
    taskMaxAgeHours: number;
    defaultOutputPath: string;
}

export interface ProxyConfig {
    timeoutMs: number;
    maxRetries: number;
}

export interface AppConfig {
    server: ServerConfig;
    videoSource: VideoSourceConfig;
    download: DownloadConfig;
    proxy: ProxyConfig;
}

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: AppConfig = {
    server: {
        port: 9876,
        verboseLogging: false,
        dataDir: './data'
    },
    videoSource: {
        initTimeoutMs: 15000,
        initRetryAttempts: 2,
        initRetryDelayMs: 1000,
        healthCheckIntervalMs: 60000,
        circuitBreakerThreshold: 3,
        circuitBreakerResetMs: 300000
    },
    download: {
        timeoutMs: 30 * 60 * 1000,  // 30分钟
        maxConcurrent: 3,
        minDiskFreeMB: 100,
        retryAttempts: 2,
        retryDelayMs: 5000,
        taskMaxAgeHours: 24,
        defaultOutputPath: './downloads'
    },
    proxy: {
        timeoutMs: 30000,
        maxRetries: 3
    }
};

// ==================== 配置加载器 ====================

class ConfigManager {
    private config: AppConfig;
    private configPath: string;

    constructor() {
        this.configPath = Deno.env.get('DV_CONFIG_PATH') || './config.json';
        this.config = this.loadConfig();
    }

    /**
     * 加载配置（合并默认值、配置文件、环境变量）
     */
    private loadConfig(): AppConfig {
        // 从配置文件加载
        const fileConfig = this.loadFromFile();
        
        // 从环境变量加载
        const envConfig = this.loadFromEnv();
        
        // 深度合并
        const merged = this.deepMerge(
            this.deepMerge(DEFAULT_CONFIG, fileConfig),
            envConfig
        );
        
        logInfo('配置加载完成');
        if (merged.server.verboseLogging) {
            logInfo('当前配置:', JSON.stringify(merged, null, 2));
        }

        return merged;
    }

    /**
     * 从配置文件加载
     */
    private loadFromFile(): DeepPartial<AppConfig> {
        try {
            const text = Deno.readTextFileSync(this.configPath);
            const parsed = JSON.parse(text);
            logInfo(`从 ${this.configPath} 加载配置`);
            return parsed;
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) {
                logInfo(`配置文件不存在，使用默认配置: ${this.configPath}`);
            } else {
                logWarn(`加载配置文件失败: ${this.configPath}`, error);
            }
            return {};
        }
    }

    /**
     * 从环境变量加载 (DV_ 前缀)
     */
    private loadFromEnv(): DeepPartial<AppConfig> {
        const config: DeepPartial<AppConfig> = {};

        // 服务器配置
        if (Deno.env.get('DV_SERVER_PORT')) {
            const port = parseInt(Deno.env.get('DV_SERVER_PORT')!, 10);
            if (!isNaN(port)) config.server = { port };
        }
        if (Deno.env.get('DV_VERBOSE') === 'true') {
            config.server = { ...config.server, verboseLogging: true };
        }
        if (Deno.env.get('DV_DATA_DIR')) {
            config.server = { ...config.server, dataDir: Deno.env.get('DV_DATA_DIR') };
        }

        // 视频源配置
        if (Deno.env.get('DV_SOURCE_INIT_TIMEOUT')) {
            const v = parseInt(Deno.env.get('DV_SOURCE_INIT_TIMEOUT')!, 10);
            if (!isNaN(v)) config.videoSource = { initTimeoutMs: v };
        }
        if (Deno.env.get('DV_SOURCE_INIT_RETRY')) {
            const v = parseInt(Deno.env.get('DV_SOURCE_INIT_RETRY')!, 10);
            if (!isNaN(v)) config.videoSource = { ...config.videoSource, initRetryAttempts: v };
        }
        if (Deno.env.get('DV_SOURCE_HEALTH_INTERVAL')) {
            const v = parseInt(Deno.env.get('DV_SOURCE_HEALTH_INTERVAL')!, 10);
            if (!isNaN(v)) config.videoSource = { ...config.videoSource, healthCheckIntervalMs: v };
        }
        if (Deno.env.get('DV_SOURCE_CB_THRESHOLD')) {
            const v = parseInt(Deno.env.get('DV_SOURCE_CB_THRESHOLD')!, 10);
            if (!isNaN(v)) config.videoSource = { ...config.videoSource, circuitBreakerThreshold: v };
        }

        // 下载配置
        if (Deno.env.get('DV_DOWNLOAD_TIMEOUT')) {
            const v = parseInt(Deno.env.get('DV_DOWNLOAD_TIMEOUT')!, 10);
            if (!isNaN(v)) config.download = { timeoutMs: v };
        }
        if (Deno.env.get('DV_DOWNLOAD_CONCURRENT')) {
            const v = parseInt(Deno.env.get('DV_DOWNLOAD_CONCURRENT')!, 10);
            if (!isNaN(v)) config.download = { ...config.download, maxConcurrent: v };
        }
        if (Deno.env.get('DV_DOWNLOAD_MIN_DISK')) {
            const v = parseInt(Deno.env.get('DV_DOWNLOAD_MIN_DISK')!, 10);
            if (!isNaN(v)) config.download = { ...config.download, minDiskFreeMB: v };
        }
        if (Deno.env.get('DV_DOWNLOAD_OUTPUT')) {
            config.download = { ...config.download, defaultOutputPath: Deno.env.get('DV_DOWNLOAD_OUTPUT') };
        }

        // 代理配置
        if (Deno.env.get('DV_PROXY_TIMEOUT')) {
            const v = parseInt(Deno.env.get('DV_PROXY_TIMEOUT')!, 10);
            if (!isNaN(v)) config.proxy = { timeoutMs: v };
        }

        return config;
    }

    /**
     * 深度合并对象
     */
    private deepMerge<T extends Record<string, any>>(target: T, source: DeepPartial<T>): T {
        const result: any = { ...target };
        
        for (const key in source) {
            if (source[key] !== undefined && source[key] !== null) {
                if (
                    typeof source[key] === 'object' &&
                    !Array.isArray(source[key]) &&
                    typeof target[key] === 'object' &&
                    target[key] !== null
                ) {
                    result[key] = this.deepMerge(target[key], source[key]);
                } else {
                    result[key] = source[key];
                }
            }
        }
        
        return result;
    }

    /**
     * 获取配置
     */
    get(): AppConfig {
        return this.config;
    }

    /**
     * 获取特定路径的配置值
     */
    getPath<T>(path: string): T | undefined {
        const parts = path.split('.');
        let current: any = this.config;
        
        for (const part of parts) {
            if (current === null || current === undefined) {
                return undefined;
            }
            current = current[part];
        }
        
        return current as T;
    }

    /**
     * 更新配置（运行时）
     */
    update(updates: DeepPartial<AppConfig>): void {
        this.config = this.deepMerge(this.config, updates);
        logInfo('配置已更新');
    }

    /**
     * 保存配置到文件
     */
    async save(): Promise<void> {
        try {
            await Deno.writeTextFile(
                this.configPath,
                JSON.stringify(this.config, null, 2)
            );
            logInfo(`配置已保存到: ${this.configPath}`);
        } catch (error) {
            logError('保存配置失败:', error);
            throw error;
        }
    }

    /**
     * 创建默认配置文件
     */
    async createDefault(): Promise<void> {
        try {
            await Deno.stat(this.configPath);
            logInfo('配置文件已存在，跳过创建');
        } catch {
            try {
                await Deno.writeTextFile(
                    this.configPath,
                    JSON.stringify(DEFAULT_CONFIG, null, 2)
                );
                logInfo(`已创建默认配置文件: ${this.configPath}`);
            } catch (error) {
                logError('创建默认配置失败:', error);
            }
        }
    }
}

// 辅助类型：深度 Partial
type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// ==================== 导出 ====================

const configManager = new ConfigManager();

export const config = configManager.get.bind(configManager);
export const getConfig = configManager.get.bind(configManager);
export const getConfigPath = configManager.getPath.bind(configManager);
export const updateConfig = configManager.update.bind(configManager);
export const saveConfig = configManager.save.bind(configManager);
export const createDefaultConfig = configManager.createDefault.bind(configManager);

export default configManager;
