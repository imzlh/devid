/**
 * @typedef {Object} VideoSource
 * @property {string} id - 视频源ID
 * @property {string} name - 视频源名称
 * @property {string} baseUrl - 基础URL
 * @property {boolean} isActive - 是否为活动源
 */

/**
 * @typedef {Object} VideoItem
 * @property {string} id - 视频ID
 * @property {string} title - 视频标题
 * @property {string} url - 视频URL
 * @property {string} thumbnail - 缩略图URL
 * @property {string} duration - 时长
 * @property {string} source - 来源
 */

/**
 * @typedef {Object} M3U8Result
 * @property {string} url - M3U8链接
 * @property {string} quality - 画质名称
 * @property {string} resolution - 分辨率
 * @property {number} bandwidth - 带宽
 */

/**
 * @typedef {Object} DownloadTask
 * @property {string} id - 下载任务ID
 * @property {string} title - 标题
 * @property {string} status - 状态
 * @property {number} progress - 进度(0-100)
 * @property {string} speed - 下载速度
 */

/**
 * API管理类
 */
class APIManager {
    constructor(baseURL = '') {
        /** @type {string} */
        this.baseURL = baseURL;
        /** @type {number} */
        this.requestTimeout = 30000;
    }
    
    /**
     * 发送HTTP请求
     * @param {string} url - 请求URL
     * @param {RequestInit} options - 请求选项
     * @returns {Promise<any>}
     */
    async request(url, options = {}) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);
        
        try {
            const response = await fetch(this.baseURL + url, {
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                signal: controller.signal,
                ...options
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            } else {
                return await response.text();
            }
        } catch (error) {
            clearTimeout(timeoutId);
            
            if (error.name === 'AbortError') {
                throw new Error('请求超时');
            }
            
            throw error;
        }
    }
    
    /**
     * GET请求
     * @param {string} url
     * @returns {Promise<any>}
     */
    async get(url) {
        return this.request(url, { method: 'GET' });
    }
    
    /**
     * POST请求
     * @param {string} url
     * @param {any} data
     * @returns {Promise<any>}
     */
    async post(url, data) {
        return this.request(url, {
            method: 'POST',
            body: data ? JSON.stringify(data) : null
        });
    }
    
    // 视频源相关API
    /**
     * 获取所有视频源
     * @returns {Promise<{sources: VideoSource[]}>}
     */
    async getSources() {
        return this.get('/api/sources');
    }
    
    /**
     * 设置活动视频源
     * @param {string} source
     * @returns {Promise<any>}
     */
    async setActiveSource(source) {
        return this.post('/api/sources/active', { id: source });
    }
    
    /**
     * 获取当前活动视频源
     * @returns {Promise<VideoSource>}
     */
    async getActiveSource() {
        return this.get('/api/sources/active');
    }
    
    // 视频内容API
    /**
     * 获取首页视频
     * @param {number} page
     * @returns {Promise<{videos: VideoItem[], currentPage: number, totalPages: number}>}
     */
    async getHomeVideos(page = 1) {
        return this.get(`/api/home-videos?page=${page}`);
    }
    
    /**
     * 搜索视频
     * @param {string} query
     * @param {number} page
     * @returns {Promise<{videos: VideoItem[], currentPage: number, totalPages: number}>}
     */
    async searchVideos(query, page = 1) {
        return this.get(`/api/search?q=${encodeURIComponent(query)}&page=${page}`);
    }
    
    /**
     * 解析视频
     * @param {string} url
     * @param {string} source
     * @returns {Promise<{results: M3U8Result[]}>}
     */
    async parseVideo(url, source) {
        return this.post('/api/parse-video', { url, source });
    }
    
    // 下载管理API
    /**
     * 创建下载任务
     * @param {string} title
     * @param {string} m3u8Url
     * @param {string} outputPath
     * @returns {Promise<{task: DownloadTask}>}
     */
    async createDownload(title, m3u8Url, outputPath, referer) {
        return this.post('/api/downloads', { title, url: m3u8Url, outputPath, referer });
    }
    
    /**
     * 开始下载
     * @param {string} id
     * @returns {Promise<any>}
     */
    async startDownload(id) {
        return this.post(`/api/downloads/${id}/start`);
    }
    
    /**
     * 获取下载列表
     * @returns {Promise<{tasks: DownloadTask[]}>}
     */
    async getDownloads() {
        return this.get('/api/downloads');
    }
    
    /**
     * 取消下载
     * @param {string} id
     * @returns {Promise<any>}
     */
    async cancelDownload(id) {
        return this.post(`/api/downloads/${id}/cancel`);
    }
    
    /**
     * 重试下载
     * @param {string} id
     * @returns {Promise<any>}
     */
    async retryDownload(id) {
        return this.post(`/api/downloads/${id}/retry`);
    }
    
    /**
     * 清除已完成下载
     * @returns {Promise<any>}
     */
    async clearCompletedDownloads() {
        return this.post('/api/downloads/clear-completed');
    }
    
    /**
     * 健康检查
     * @returns {Promise<any>}
     */
    async healthCheck() {
        return this.get('/api/health');
    }
    
    /**
     * 获取代理URL
     * @param {string} url
     * @param {string} source
     * @returns {string}
     */
    getProxyUrl(url, source) {
        const filename = url.split('/').pop();
        return `/api/proxy/${filename}?url=${encodeURIComponent(url)}${source ? `&source=${source}` : ''}&referer=${encodeURIComponent(url)}`;
    }
    
    /**
     * 获取图片代理URL
     * @param {string} url
     * @param {string} source
     * @returns {string}
     */
    getImageProxyUrl(url, source) {
        return `/api/image-proxy?url=${encodeURIComponent(url)}&source=${source}`;
    }
}

/**
 * 视频播放器管理类
 */
class VideoPlayerManager {
    constructor() {
        /** @type {any|null} ArtPlayer实例 */
        this.player = null;
        /** @type {VideoItem|null} */
        this.currentVideo = null;
        /** @type {M3U8Result[]} */
        this.qualities = [];
        /** @type {number} */
        this.currentQualityIndex = 0;
    }
    
    /**
     * 初始化播放器
     * @param {HTMLElement} container - 容器元素
     * @param {VideoItem} videoData - 视频数据
     * @returns {Promise<any>}
     */
    async initPlayer(container, videoData) {
        // 销毁现有播放器
        this.destroy();
        
        // 设置当前视频数据
        this.currentVideo = videoData;
        
        // 检查ArtPlayer是否可用
        if (typeof Artplayer === 'undefined') {
            throw new Error('ArtPlayer未加载');
        }
        
        // 创建新播放器
        this.player = new Artplayer({
            container: container,
            url: '',
            title: videoData.title,
            poster: videoData.thumbnail,
            volume: 0.7,
            isLive: false,
            muted: false,
            autoplay: true,
            pip: true,
            autoSize: false,
            autoMini: true,
            screenshot: true,
            setting: true,
            loop: false,
            flip: true,
            playbackRate: true,
            aspectRatio: true,
            fullscreen: true,
            fullscreenWeb: true,
            subtitleOffset: true,
            miniProgressBar: true,
            mutex: true,
            backdrop: true,
            playsInline: false,
            autoPlayback: true,
            airplay: true,
            theme: '#007bff',
            lang: 'zh-cn',
            whitelist: ['*'],
            moreVideoAttr: {
                crossOrigin: 'anonymous',
            },
            customType: {
                m3u8: function(video, url) {
                    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                        const hls = new Hls();
                        hls.loadSource(url);
                        hls.attachMedia(video);
                    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                        video.src = url;
                    }
                }
            }
        });
        
        // 添加自动播放逻辑
        this.player.on('video:loadedmetadata', () => {
            // 如果是首次加载（currentTime为0），则自动播放
            if (this.player.video.currentTime === 0) {
                this.player.play();
            }
        });
        
        return this.player;
    }
    
    /**
     * 设置画质列表
     * @param {M3U8Result[]} qualities
     */
    setQualities(qualities) {
        this.qualities = qualities;
        this.currentQualityIndex = 0;
        
        if (this.player && qualities.length > 0) {
            // 设置默认质量（选择第一个）
            console.log('设置默认画质:', qualities[0].resolution || '未知', 'URL:', qualities[0].url);
            this.switchQuality(qualities[0], 0);
        } else {
            console.warn('没有可用的画质');
        }
    }
    
    /**
     * 切换画质
     * @param {M3U8Result} quality
     * @param {number} index
     */
    switchQuality(quality, index = 0) {
        if (!this.player || !quality.url || !this.currentVideo) return;
        
        this.currentQualityIndex = index;
        
        // 构建代理URL
        const proxyUrl = `/api/proxy/video.m3u8?url=${encodeURIComponent(quality.url)}&source=${this.currentVideo.source}&referer=${encodeURIComponent(this.currentVideo.url)}`;
        
        try {
            this.player.switchUrl(proxyUrl);
            
            console.log('已切换到画质:', quality.resolution || '未知', 'URL:', proxyUrl);
        } catch (error) {
            console.error('切换画质失败:', error);
        }
    }
    
    /**
     * 获取当前画质
     * @returns {M3U8Result|null}
     */
    getCurrentQuality() {
        return this.qualities[this.currentQualityIndex] || null;
    }
    
    /**
     * 销毁播放器
     */
    destroy() {
        if (this.player) {
            try {
                this.player.destroy();
            } catch (error) {
                console.error('销毁播放器失败:', error);
            }
            this.player = null;
        }
        this.currentVideo = null;
        this.qualities = [];
        this.currentQualityIndex = 0;
    }
}