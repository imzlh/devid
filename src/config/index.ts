/**
 * 统一配置管理模块
 *
 * 优先级（从高到低）：
 * 1. 环境变量 (DV_前缀)
 * 2. 配置文件 (config.json)
 * 3. 默认值
 */

import { logError, logInfo, logWarn } from "../utils/logger.ts";

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
  gateway: string;
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
    dataDir: "./data",
  },
  videoSource: {
    initTimeoutMs: 15000,
    initRetryAttempts: 2,
    initRetryDelayMs: 1000,
    healthCheckIntervalMs: 60000,
    circuitBreakerThreshold: 3,
    circuitBreakerResetMs: 300000,
  },
  download: {
    timeoutMs: 30 * 60 * 1000, // 30分钟
    maxConcurrent: 3,
    minDiskFreeMB: 100,
    retryAttempts: 2,
    retryDelayMs: 5000,
    taskMaxAgeHours: 24,
    defaultOutputPath: "./downloads",
  },
  proxy: {
    timeoutMs: 30000,
    maxRetries: 3,
    gateway: "",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

function parseEnvInteger(
  value: string | undefined,
  min?: number,
  max?: number,
): number | undefined {
  const normalized = value?.trim();
  if (!normalized || !/^-?\d+$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) return undefined;
  if (min !== undefined && parsed < min) return undefined;
  if (max !== undefined && parsed > max) return undefined;
  return parsed;
}

function nonEmptyEnvString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parseConfigInteger(
  value: unknown,
  min?: number,
  max?: number,
): number | undefined {
  const normalized = (() => {
    if (typeof value === "number") return value;
    if (typeof value !== "string") return Number.NaN;
    const text = value.trim();
    return /^-?\d+$/.test(text) ? Number(text) : Number.NaN;
  })();
  if (!Number.isSafeInteger(normalized)) return undefined;
  if (min !== undefined && normalized < min) return undefined;
  if (max !== undefined && normalized > max) return undefined;
  return normalized;
}

function parseConfigBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function parseConfigString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

export function normalizeConfigInput(value: unknown): DeepPartial<AppConfig> {
  if (!isRecord(value)) return {};
  const config: DeepPartial<AppConfig> = {};

  if (isRecord(value.server)) {
    const server: DeepPartial<ServerConfig> = {};
    const port = parseConfigInteger(value.server.port, 1, 65535);
    if (port !== undefined) server.port = port;
    const verboseLogging = parseConfigBoolean(value.server.verboseLogging);
    if (verboseLogging !== undefined) server.verboseLogging = verboseLogging;
    const dataDir = parseConfigString(value.server.dataDir);
    if (dataDir) server.dataDir = dataDir;
    if (Object.keys(server).length) config.server = server;
  }

  if (isRecord(value.videoSource)) {
    const videoSource: DeepPartial<VideoSourceConfig> = {};
    const initTimeoutMs = parseConfigInteger(
      value.videoSource.initTimeoutMs,
      1,
    );
    if (initTimeoutMs !== undefined) {
      videoSource.initTimeoutMs = initTimeoutMs;
    }
    const initRetryAttempts = parseConfigInteger(
      value.videoSource.initRetryAttempts,
      1,
    );
    if (initRetryAttempts !== undefined) {
      videoSource.initRetryAttempts = initRetryAttempts;
    }
    const initRetryDelayMs = parseConfigInteger(
      value.videoSource.initRetryDelayMs,
      0,
    );
    if (initRetryDelayMs !== undefined) {
      videoSource.initRetryDelayMs = initRetryDelayMs;
    }
    const healthCheckIntervalMs = parseConfigInteger(
      value.videoSource.healthCheckIntervalMs,
      1,
    );
    if (healthCheckIntervalMs !== undefined) {
      videoSource.healthCheckIntervalMs = healthCheckIntervalMs;
    }
    const circuitBreakerThreshold = parseConfigInteger(
      value.videoSource.circuitBreakerThreshold,
      1,
    );
    if (circuitBreakerThreshold !== undefined) {
      videoSource.circuitBreakerThreshold = circuitBreakerThreshold;
    }
    const circuitBreakerResetMs = parseConfigInteger(
      value.videoSource.circuitBreakerResetMs,
      1,
    );
    if (circuitBreakerResetMs !== undefined) {
      videoSource.circuitBreakerResetMs = circuitBreakerResetMs;
    }
    if (Object.keys(videoSource).length) config.videoSource = videoSource;
  }

  if (isRecord(value.download)) {
    const download: DeepPartial<DownloadConfig> = {};
    const timeoutMs = parseConfigInteger(value.download.timeoutMs, 1);
    if (timeoutMs !== undefined) download.timeoutMs = timeoutMs;
    const maxConcurrent = parseConfigInteger(value.download.maxConcurrent, 1);
    if (maxConcurrent !== undefined) download.maxConcurrent = maxConcurrent;
    const minDiskFreeMB = parseConfigInteger(value.download.minDiskFreeMB, 0);
    if (minDiskFreeMB !== undefined) download.minDiskFreeMB = minDiskFreeMB;
    const retryAttempts = parseConfigInteger(value.download.retryAttempts, 1);
    if (retryAttempts !== undefined) download.retryAttempts = retryAttempts;
    const retryDelayMs = parseConfigInteger(value.download.retryDelayMs, 0);
    if (retryDelayMs !== undefined) download.retryDelayMs = retryDelayMs;
    const taskMaxAgeHours = parseConfigInteger(
      value.download.taskMaxAgeHours,
      1,
    );
    if (taskMaxAgeHours !== undefined) {
      download.taskMaxAgeHours = taskMaxAgeHours;
    }
    const defaultOutputPath = parseConfigString(
      value.download.defaultOutputPath,
    );
    if (defaultOutputPath) download.defaultOutputPath = defaultOutputPath;
    if (Object.keys(download).length) config.download = download;
  }

  if (isRecord(value.proxy)) {
    const proxy: DeepPartial<ProxyConfig> = {};
    const timeoutMs = parseConfigInteger(value.proxy.timeoutMs, 1);
    if (timeoutMs !== undefined) proxy.timeoutMs = timeoutMs;
    const maxRetries = parseConfigInteger(value.proxy.maxRetries, 0);
    if (maxRetries !== undefined) proxy.maxRetries = maxRetries;
    const gateway = parseConfigString(value.proxy.gateway);
    if (gateway) proxy.gateway = gateway;
    if (Object.keys(proxy).length) config.proxy = proxy;
  }

  return config;
}

export function loadConfigFromEnv(
  readEnv: (name: string) => string | undefined = getEnv,
): DeepPartial<AppConfig> {
  const config: DeepPartial<AppConfig> = {};

  // 服务器配置
  const serverPort = parseEnvInteger(readEnv("DV_SERVER_PORT"), 1, 65535);
  if (serverPort !== undefined) config.server = { port: serverPort };
  if (readEnv("DV_VERBOSE") === "true") {
    config.server = { ...config.server, verboseLogging: true };
  }
  const dataDir = nonEmptyEnvString(readEnv("DV_DATA_DIR"));
  if (dataDir) {
    config.server = { ...config.server, dataDir };
  }

  // 视频源配置
  const sourceInitTimeout = parseEnvInteger(
    readEnv("DV_SOURCE_INIT_TIMEOUT"),
    1,
  );
  if (sourceInitTimeout !== undefined) {
    config.videoSource = { initTimeoutMs: sourceInitTimeout };
  }
  const sourceInitRetry = parseEnvInteger(readEnv("DV_SOURCE_INIT_RETRY"), 1);
  if (sourceInitRetry !== undefined) {
    config.videoSource = {
      ...config.videoSource,
      initRetryAttempts: sourceInitRetry,
    };
  }
  const sourceHealthInterval = parseEnvInteger(
    readEnv("DV_SOURCE_HEALTH_INTERVAL"),
    1,
  );
  if (sourceHealthInterval !== undefined) {
    config.videoSource = {
      ...config.videoSource,
      healthCheckIntervalMs: sourceHealthInterval,
    };
  }
  const sourceCircuitThreshold = parseEnvInteger(
    readEnv("DV_SOURCE_CB_THRESHOLD"),
    1,
  );
  if (sourceCircuitThreshold !== undefined) {
    config.videoSource = {
      ...config.videoSource,
      circuitBreakerThreshold: sourceCircuitThreshold,
    };
  }

  // 下载配置
  const downloadTimeout = parseEnvInteger(readEnv("DV_DOWNLOAD_TIMEOUT"), 1);
  if (downloadTimeout !== undefined) {
    config.download = { timeoutMs: downloadTimeout };
  }
  const downloadConcurrent = parseEnvInteger(
    readEnv("DV_DOWNLOAD_CONCURRENT"),
    1,
  );
  if (downloadConcurrent !== undefined) {
    config.download = { ...config.download, maxConcurrent: downloadConcurrent };
  }
  const downloadMinDisk = parseEnvInteger(readEnv("DV_DOWNLOAD_MIN_DISK"), 0);
  if (downloadMinDisk !== undefined) {
    config.download = { ...config.download, minDiskFreeMB: downloadMinDisk };
  }
  const downloadOutput = nonEmptyEnvString(readEnv("DV_DOWNLOAD_OUTPUT"));
  if (downloadOutput) {
    config.download = { ...config.download, defaultOutputPath: downloadOutput };
  }

  // 代理配置
  const proxyTimeout = parseEnvInteger(readEnv("DV_PROXY_TIMEOUT"), 1);
  if (proxyTimeout !== undefined) config.proxy = { timeoutMs: proxyTimeout };
  const proxyMaxRetries = parseEnvInteger(readEnv("DV_PROXY_MAX_RETRIES"), 0);
  if (proxyMaxRetries !== undefined) {
    config.proxy = { ...config.proxy, maxRetries: proxyMaxRetries };
  }
  const proxyGateway = nonEmptyEnvString(readEnv("DV_PROXY_GATEWAY"));
  if (proxyGateway) {
    config.proxy = { ...config.proxy, gateway: proxyGateway };
  }

  return config;
}

// ==================== 配置加载器 ====================

class ConfigManager {
  private config: AppConfig;
  private configPath: string;

  constructor() {
    this.configPath = getEnv("DV_CONFIG_PATH") || "./config.json";
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
      envConfig,
    );

    logInfo("配置加载完成");
    if (merged.server.verboseLogging) {
      logInfo("当前配置:", JSON.stringify(merged, null, 2));
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
      return normalizeConfigInput(parsed);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        logInfo(`配置文件不存在，使用默认配置: ${this.configPath}`);
      } else if (
        error instanceof Deno.errors.PermissionDenied ||
        error instanceof Deno.errors.NotCapable
      ) {
        logInfo(`无权限读取配置文件，使用默认配置: ${this.configPath}`);
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
    return loadConfigFromEnv(getEnv);
  }

  /**
   * 深度合并对象
   */
  private deepMerge<T extends object>(target: T, source: DeepPartial<T>): T {
    const result: Record<string, unknown> = {
      ...(target as Record<string, unknown>),
    };
    const sourceRecord = source as Record<string, unknown>;
    const targetRecord = target as Record<string, unknown>;

    for (const key in sourceRecord) {
      const value = sourceRecord[key];
      if (value !== undefined && value !== null) {
        const targetValue = targetRecord[key];
        if (
          isRecord(value) &&
          isRecord(targetValue)
        ) {
          result[key] = this.deepMerge(targetValue, value);
        } else {
          result[key] = value;
        }
      }
    }

    return result as T;
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
    const parts = path.split(".");
    let current: unknown = this.config;

    for (const part of parts) {
      if (!isRecord(current)) {
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
    this.config = this.deepMerge(this.config, normalizeConfigInput(updates));
    logInfo("配置已更新");
  }

  /**
   * 保存配置到文件
   */
  async save(): Promise<void> {
    try {
      await Deno.writeTextFile(
        this.configPath,
        JSON.stringify(this.config, null, 2),
      );
      logInfo(`配置已保存到: ${this.configPath}`);
    } catch (error) {
      logError("保存配置失败:", error);
      throw error;
    }
  }

  /**
   * 创建默认配置文件
   */
  async createDefault(): Promise<void> {
    try {
      await Deno.stat(this.configPath);
      logInfo("配置文件已存在，跳过创建");
    } catch {
      try {
        await Deno.writeTextFile(
          this.configPath,
          JSON.stringify(DEFAULT_CONFIG, null, 2),
        );
        logInfo(`已创建默认配置文件: ${this.configPath}`);
      } catch (error) {
        logError("创建默认配置失败:", error);
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
export const createDefaultConfig = configManager.createDefault.bind(
  configManager,
);

export default configManager;
