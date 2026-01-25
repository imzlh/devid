// 视频项接口
export interface VideoItem {
    id: string;
    title: string;
    thumbnail: string;
    duration?: string;
    views?: string;
    uploadTime?: string;
    url: string;
    source: string;
}

// 视频详情接口
export interface VideoDetails {
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

// 视频列表结果接口
export interface VideoList {
    videos: VideoItem[];
    currentPage: number;
    totalPages: number;
}

// 视频源接口
export interface VideoSource {
    name: string;
    id: string;
    baseUrl: string;
    enabled: boolean;
}

// M3U8解析结果接口
export interface M3U8Result {
    url: string;
    quality: string;
    resolution?: string;
    bandwidth?: number;
}

// 下载任务接口
export interface DownloadTask {
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
}

// 图片数据接口
export interface ImageData {
    data: Uint8Array;
    contentType: string;
}

// types/m3u8.ts - 完整的类型定义
export interface M3U8Manifest {
    version: number;
    targetDuration: number;
    mediaSequence: number;
    endList: boolean;
    segments: M3U8Segment[];
    // 主播放列表属性
    variants?: M3U8Variant[];
    // 媒体相关属性
    mediaGroups?: {
        audio?: Map<string, M3U8MediaGroup>;
        video?: Map<string, M3U8MediaGroup>;
        subtitles?: Map<string, M3U8MediaGroup>;
    };
}

export interface M3U8Segment {
    uri: string;           // 片段URL
    duration: number;      // 时长(秒)
    title?: string;        // 标题
    sequence: number;      // 序列号

    // 加密信息
    key?: {
        method: string;      // AES-128, SAMPLE-AES等
        uri?: string;        // 密钥URL
        iv?: Uint8Array;     // 初始化向量
        format?: string;
        keyFormatVersions?: string;
    };

    // 初始化片段
    map?: {
        uri: string;         // 初始化片段URL
        byterange?: string;  // 字节范围
    };

    // 其他属性
    discontinuity?: boolean;
    programDateTime?: string;
    byterange?: string;
}

export interface M3U8Variant {
    uri: string;           // 变体播放列表URL
    bandwidth: number;     // 必需参数
    averageBandwidth?: number;
    codecs?: string;
    resolution?: { width: number; height: number };
    frameRate?: number;
    hdcpLevel?: string;
    audio?: string;
    video?: string;
    subtitles?: string;
    closedCaptions?: string;
    name?: string;         // 自定义名称
}

export interface M3U8MediaGroup {
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