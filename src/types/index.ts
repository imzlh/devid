// 内容类型
export type IContentType = 'video' | 'series' | 'infinite';

// 系列类型
export type ISeriesType = 'anime' | 'drama' | 'movie' | 'variety' | 'documentary' | 'other';

// 系列状态
export type ISeriesStatus = 'ongoing' | 'completed' | 'upcoming' | 'hiatus';

// 视频/系列项（统一类型，支持混排）
export interface IVideoItem {
    id: string;
    title: string;
    thumbnail: string;
    duration?: string;
    views?: string;
    uploadTime?: string;
    url: string;
    source: string;
    contentType?: IContentType;  // 默认为video
    seriesInfo?: Partial<ISeriesDetail>;  // 系列基本信息（用于混排展示，部分字段）
}

// 视频详情
export interface IVideoDetails {
    id: string;
    title: string;
    description?: string;
    url: string;
    thumbnail: string;
    duration?: string;
    views?: string;
    likes?: string;
    dislikes?: string;
    uploadedAt?: string;
    uploader?: {
        id: string;
        name: string;
        avatar?: string;
        subscribers?: string;
    };
    tags?: string[];
}

// 视频列表（支持混排）
export interface IVideoList {
    videos: IVideoItem[];
    currentPage: number;
    totalPages: number;
}

// 剧集
export interface IEpisode {
    id: string;
    seriesId: string;
    title: string;
    episodeNumber: number;
    seasonNumber?: number;
    thumbnail?: string;
    duration?: string;
    url: string;
    description?: string;
    airDate?: string;
}

// 系列详情（基本信息，不包含完整剧集列表）
export interface ISeriesDetail {
    id: string;
    title: string;
    originalTitle?: string;
    aliases?: string[];
    description?: string;
    thumbnail: string;
    type?: ISeriesType;
    status?: ISeriesStatus;
    year?: number;
    tags?: string[];
    rating?: number;
    views?: number;
    totalEpisodes: number;
    episodes?: IEpisode[];  // 可选，getSeriesDetail 不返回，getSeriesList 返回
    source: string;
    currentEpisode?: number;
}

// 系列剧集列表结果
export interface ISeriesResult extends ISeriesDetail {
    seriesId: string;
    url: string;
}

// 视频源健康状态
export interface ISourceHealth {
    status: 'healthy' | 'unhealthy' | 'unknown';
    lastCheck: number;
    consecutiveFailures: number;
    circuitOpen: boolean;
    circuitOpenUntil: number;
    lastError?: string;
}

// 视频源
export interface ISource {
    name: string;
    id: string;
    baseUrl: string;
    enabled: boolean;
    health?: ISourceHealth;
    /** 图片宽高比，默认16/9 */
    imageAspectRatio?: string;
}

export enum URLProxy {
    NONE = 0,       // 不使用
    LOCAL,          // 本地服务器代理，适用于无GFW ban的情况
    REMOTE          // 远程代理，适用于有GFW ban的情况
}

// M3U8解析结果
export interface IVideoURL {
    url: string;
    quality: string;
    resolution?: string;
    bandwidth?: number;
    format?: 'm3u8' | 'h5';  // 支持M3U8和MP4格式
    referrer?: string;  // 用于前端?referer参数
    proxy?: UseProxy;
}

// 下载任务
export interface IDownloadTask {
    id: string;
    url: string;
    referer?: string;
    title: string;
    outputPath: string;
    filePath: string;
    fileName: string;
    status: 'pending' | 'downloading' | 'completed' | 'error' | 'cancelled';
    progress: number;
    createTime: Date;
    startTime?: Date;
    endTime?: Date;
    error?: string;
    totalSegments?: number;
    retryCount?: number;
    maxRetries?: number;
}

// 持久化下载任务
export interface IDownloadTaskPersisted {
    id: string;
    url: string;
    referer?: string;
    title: string;
    outputPath: string;
    filePath: string;
    fileName: string;
    status: 'pending' | 'downloading' | 'completed' | 'error' | 'cancelled';
    progress: number;
    createTime: string;
    startTime?: string;
    endTime?: string;
    error?: string;
    totalSegments?: number;
    retryCount?: number;
    maxRetries?: number;
}

// 图片数据
export interface IImageData {
    data: Uint8Array;
    contentType: string;
}

// M3U8类型定义
export interface IM3U8Manifest {
    version: number;
    targetDuration: number;
    mediaSequence: number;
    endList: boolean;
    segments: IM3U8Segment[];
    variants?: IM3U8Variant[];
    mediaGroups?: {
        audio?: Map<string, IM3U8MediaGroup>;
        video?: Map<string, IM3U8MediaGroup>;
        subtitles?: Map<string, IM3U8MediaGroup>;
    };
}

export interface IM3U8Segment {
    uri: string;
    duration: number;
    title?: string;
    sequence: number;
    key?: {
        method: string;
        uri?: string;
        iv?: Uint8Array;
        format?: string;
        keyFormatVersions?: string;
    };
    map?: {
        uri: string;
        byterange?: string;
    };
    discontinuity?: boolean;
    programDateTime?: string;
    byterange?: string;
}

export interface IM3U8Variant {
    uri: string;
    bandwidth?: number;
    averageBandwidth?: number;
    codecs?: string;
    resolution?: { width: number; height: number };
    frameRate?: number;
    hdcpLevel?: string;
    audio?: string;
    video?: string;
    subtitles?: string;
    closedCaptions?: string;
    name?: string;
}

export interface IM3U8MediaGroup {
    type: 'AUDIO' | 'VIDEO' | 'SUBTITLES' | 'CLOSED-CAPTIONS';
    groupId: string;
    name: string;
    default?: boolean;
    autoselect?: boolean;
    forced?: boolean;
    language?: string;
    uri?: string;
    characteristics?: string;
}
