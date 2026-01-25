// 日志级别
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    NONE = 4
}

// 日志配置
interface LogConfig {
    level: LogLevel;
    enableTimestamp: boolean;
    enableSourceLocation: boolean;
}

// 默认配置
let config: LogConfig = {
    level: LogLevel.INFO,
    enableTimestamp: true,
    enableSourceLocation: true
};

// 设置日志配置
export function setLogConfig(newConfig: Partial<LogConfig>): void {
    config = { ...config, ...newConfig };
}

// 获取当前日志级别
export function getLogLevel(): LogLevel {
    return config.level;
}

// 获取日志级别名称
function getLevelName(level: LogLevel): string {
    switch (level) {
        case LogLevel.DEBUG:
            return 'DEBUG';
        case LogLevel.INFO:
            return 'INFO';
        case LogLevel.WARN:
            return 'WARN';
        case LogLevel.ERROR:
            return 'ERROR';
        default:
            return 'UNKNOWN';
    }
}

// 格式化日志消息
function formatMessage(level: LogLevel, message: string, source?: any): string {
    const parts: string[] = [];

    // 添加时间戳
    if (config.enableTimestamp) {
        parts.push(`[${new Date().toISOString()}]`);
    }

    // 添加日志级别
    parts.push(`[${getLevelName(level)}]`);

    // 添加消息
    parts.push(message);

    // 添加源位置
    if (config.enableSourceLocation && source) {
        parts.push(String(source));
    }

    return parts.join(' ');
}

// 日志函数
export function logDebug(message: string, source?: any): void {
    if (config.level <= LogLevel.DEBUG) {
        console.log(formatMessage(LogLevel.DEBUG, message, source));
    }
}

export function logInfo(message: string, source?: any): void {
    if (config.level <= LogLevel.INFO) {
        console.log(formatMessage(LogLevel.INFO, message, source));
    }
}

export function logWarn(message: string, source?: any): void {
    if (config.level <= LogLevel.WARN) {
        console.warn(formatMessage(LogLevel.WARN, message, source));
    }
}

export function logError(message: string, source?: any): void {
    if (config.level <= LogLevel.ERROR) {
        console.error(formatMessage(LogLevel.ERROR, message, source));
    }
}

// 启用详细日志
export function enableVerboseLogs(): void {
    setLogConfig({
        level: LogLevel.DEBUG,
        enableTimestamp: true,
        enableSourceLocation: true
    });
}

// 禁用所有日志
export function disableAllLogs(): void {
    setLogConfig({
        level: LogLevel.NONE,
        enableTimestamp: false,
        enableSourceLocation: false
    });
}