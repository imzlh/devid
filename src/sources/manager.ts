import { BaseVideoSource } from './base.ts';
import { VideoSource } from '../types/index.ts';
import S_GG51 from './gg51.ts';
import S_KPdz from './kpdz.ts';
import { logError, logInfo } from "../utils/logger.ts";

const DEFAULT_SOURCES: { new(): BaseVideoSource }[] = [
    S_GG51,
    S_KPdz
];

// 视频源管理器
export class VideoSourceManager {
    private sources: Map<string, BaseVideoSource> = new Map();
    private activeSourceId: string | null = null;

    constructor() {
        for (const source of DEFAULT_SOURCES) {
            this.registerSource(new source());
        }
        this.activeSourceId = this.sources.values().next().value?.getId() || null;
        
        // 设置默认活动源
        if (this.sources.size > 0) {
            this.activeSourceId = this.sources.keys().next().value || null;
        }
    }

    // 初始化所有视频源
    async initAllSources(): Promise<void> {
        const failedSources: string[] = [];
        
        // 并行初始化所有源
        const initPromises = Array.from(this.sources.entries()).map(async ([id, source]) => {
            try {
                await source.init();
                logInfo(`视频源 ${id} 初始化成功`);
                return { id, success: true };
            } catch (error) {
                logError(`视频源 ${id} 初始化失败:`, error);
                return { id, success: false, error };
            }
        });
        
        // 等待所有初始化完成
        const results = await Promise.all(initPromises);
        
        // 收集失败的源
        for (const result of results) {
            if (!result.success) {
                failedSources.push(result.id);
            }
        }
        
        // 移除初始化失败的源
        for (const id of failedSources) {
            this.removeSource(id);
            logInfo(`已移除初始化失败的源: ${id}`);
        }
        
        // 如果所有源都失败了，抛出错误
        if (failedSources.length === this.sources.size + failedSources.length) {
            throw new Error('所有视频源初始化失败');
        }
    }

    // 初始化指定视频源
    async initSource(sourceId: string): Promise<boolean> {
        const source = this.sources.get(sourceId);
        if (!source) {
            return false;
        }
        
        try {
            await source.init();
            logInfo(`视频源 ${sourceId} 初始化成功`);
            return true;
        } catch (error) {
            logError(`视频源 ${sourceId} 初始化失败:`, error);
            // 移除初始化失败的源
            this.removeSource(sourceId);
            logInfo(`已移除初始化失败的源: ${sourceId}`);
            return false;
        }
    }

    // 注册视频源
    registerSource(source: BaseVideoSource): void {
        this.sources.set(source.getId(), source);
    }

    // 获取所有视频源
    getAllSources(): VideoSource[] {
        const sources: VideoSource[] = [];
        
        for (const [id, source] of this.sources) {
            sources.push({
                id,
                name: source.getName(),
                baseUrl: (source as any).baseUrl || '', // 访问受保护成员
                enabled: true
            });
        }
        
        return sources;
    }

    // 获取活动视频源
    getActiveSource(): BaseVideoSource | null {
        if (!this.activeSourceId) {
            return null;
        }
        
        return this.sources.get(this.activeSourceId) || null;
    }

    // 设置活动视频源
    setActiveSource(sourceId: string): boolean {
        if (this.sources.has(sourceId)) {
            this.activeSourceId = sourceId;
            return true;
        }
        
        return false;
    }

    // 获取视频源
    getSource(sourceId: string): BaseVideoSource | null {
        return this.sources.get(sourceId) || null;
    }

    // 获取当前活动源ID
    getActiveSourceId(): string | null {
        return this.activeSourceId;
    }
    
    // 移除视频源
    removeSource(sourceId: string): boolean {
        if (this.sources.has(sourceId)) {
            this.sources.delete(sourceId);
            
            // 如果移除的是活动源，则设置新的活动源
            if (this.activeSourceId === sourceId) {
                if (this.sources.size > 0) {
                    this.activeSourceId = this.sources.keys().next().value || null;
                } else {
                    this.activeSourceId = null;
                }
            }
            return true;
        }
        return false;
    }
    
    // 从配置文件加载视频源
    async loadSourcesFromConfig(configPath: string): Promise<void> {
        try {
            const configText = await Deno.readTextFile(configPath);
            const config = JSON.parse(configText);
            
            if (config.sources && Array.isArray(config.sources)) {
                for (const sourceConfig of config.sources) {
                    try {
                        // 动态导入视频源类
                        const module = await import(sourceConfig.modulePath);
                        const SourceClass = module[sourceConfig.className];
                        
                        if (SourceClass && typeof SourceClass === 'function') {
                            const source = new SourceClass();
                            this.registerSource(source);
                        }
                    } catch (error) {
                        logError(`加载视频源失败: ${sourceConfig.className}`, error);
                    }
                }
            }
            
            // 设置活动源
            if (config.activeSource && this.sources.has(config.activeSource)) {
                this.activeSourceId = config.activeSource;
            }
        } catch (error) {
            logError('加载视频源配置失败:', error);
        }
    }
    
    // 保存视频源配置到文件
    async saveSourcesToConfig(configPath: string): Promise<void> {
        try {
            const config: any = {
                activeSource: this.activeSourceId,
                sources: []
            };
            
            for (const [id, source] of this.sources) {
                // 只保存非内置视频源
                if (id !== 'example') {
                    config.sources.push({
                        id,
                        name: source.getName(),
                        modulePath: (source.constructor as any).modulePath || '',
                        className: source.constructor.name
                    });
                }
            }
            
            await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2));
        } catch (error) {
            logError('保存视频源配置失败:', error);
        }
    }
    
    // 重置为默认配置
    resetToDefault(): void {
        this.sources.clear();
        this.activeSourceId = null;
    }
}