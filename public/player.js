// enum URLProxy
const URLProxy = {
    NONE: 0,
    REMOTE: 2,
    LOCAL: 1
};

/**
 * 播放进度管理类
 * 支持：进度跟踪、最近观看记录、系列关联
 */
class ProgressManager {
    constructor() {
        this.storageKey = 'vdown_video_progress';
        this.recentKey = 'vdown_recent_watch';
        this.progressData = this.loadProgress();
        this.recentWatch = this.loadRecentWatch();

        // 覆盖Artplayer
        Artplayer.PLAYBACK_RATE = [0.75, 1, 1.25, 1.5, 2, 3, 4];
    }

    /**
     * 从localStorage加载播放进度
     * @returns {Object}
     */
    loadProgress() {
        try {
            const data = localStorage.getItem(this.storageKey);
            return data ? JSON.parse(data) : {};
        } catch (error) {
            console.error('Failed to load progress:', error);
            return {};
        }
    }

    /**
     * 加载最近观看记录
     * @returns {Array}
     */
    loadRecentWatch() {
        try {
            const data = localStorage.getItem(this.recentKey);
            return data ? JSON.parse(data) : [];
        } catch (error) {
            console.error('Failed to load recent watch:', error);
            return [];
        }
    }

    /**
     * 保存播放进度到localStorage
     */
    saveProgress() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.progressData));
        } catch (error) {
            console.error('Failed to save progress:', error);
        }
    }

    /**
     * 保存最近观看记录
     */
    saveRecentWatch() {
        try {
            localStorage.setItem(this.recentKey, JSON.stringify(this.recentWatch));
        } catch (error) {
            console.error('Failed to save recent watch:', error);
        }
    }

    /**
     * 保存视频播放进度
     * @param {string} videoId - 视频ID
     * @param {number} time - 播放时间(秒)
     * @param {number} duration - 视频总时长(秒)
     * @param {Object} meta - 视频元数据 {title, thumbnail, seriesId, episodeNumber, source}
     */
    saveVideoProgress(videoId, time, duration, meta = {}) {
        if (!videoId) return;

        // 保存进度数据
        this.progressData[videoId] = {
            time: time,
            duration: duration,
            lastUpdated: Date.now(),
            seriesId: meta.seriesId || null,
            episodeNumber: meta.episodeNumber || null
        };

        // 同时更新最近观看记录
        if (meta.title) {
            this.addRecentWatch({
                id: videoId,
                title: meta.title,
                thumbnail: meta.thumbnail || '',
                seriesId: meta.seriesId || null,
                seriesTitle: meta.seriesTitle || meta.title,
                episodeNumber: meta.episodeNumber || null,
                episodeTitle: meta.episodeTitle || meta.title,
                progress: time,
                duration: duration,
                source: meta.source || '',
                lastWatch: Date.now()
            });
        }

        this.saveProgress();
    }

    /**
     * 添加最近观看记录
     * @param {Object} watchRecord - 观看记录
     */
    addRecentWatch(watchRecord) {
        // 移除重复记录
        // 对于系列视频，按 seriesId 去重；对于普通视频，按 id 去重
        if (watchRecord.seriesId) {
            // 系列视频：移除同一系列的其他记录
            this.recentWatch = this.recentWatch.filter(r => r.seriesId !== watchRecord.seriesId);
        } else {
            // 普通视频：移除同一视频的记录
            this.recentWatch = this.recentWatch.filter(r => r.id !== watchRecord.id || r.seriesId);
        }

        // 添加到开头
        this.recentWatch.unshift(watchRecord);

        // 只保留最近20条
        if (this.recentWatch.length > 20) {
            this.recentWatch = this.recentWatch.slice(0, 20);
        }

        this.saveRecentWatch();
    }

    /**
     * 获取最近观看记录
     * @param {number} limit - 返回数量限制
     * @returns {Array}
     */
    getRecentWatch(limit = 10) {
        // 清理过期记录（超过30天）
        const now = Date.now();
        this.recentWatch = this.recentWatch.filter(r => {
            return (now - r.lastWatch) < 30 * 24 * 60 * 60 * 1000;
        });
        this.saveRecentWatch();
        
        return this.recentWatch.slice(0, limit);
    }

    /**
     * 获取视频播放进度
     * @param {string} videoId - 视频ID
     * @returns {number} 播放时间(秒)
     */
    getVideoProgress(videoId) {
        if (!videoId || !this.progressData[videoId]) {
            return 0;
        }

        const progress = this.progressData[videoId];
        // 如果进度超过30天，返回0
        if (Date.now() - progress.lastUpdated > 30 * 24 * 60 * 60 * 1000) {
            delete this.progressData[videoId];
            this.saveProgress();
            return 0;
        }

        return progress.time || 0;
    }

    /**
     * 获取剧集播放进度
     * @param {string} episodeId - 剧集ID
     * @returns {number} 播放时间(秒)
     */
    getEpisodePosition(episodeId) {
        return this.getVideoProgress(episodeId);
    }

    /**
     * 保存剧集播放进度
     * @param {string} episodeId - 剧集ID
     * @param {number} time - 播放时间(秒)
     * @param {Object} meta - 剧集元数据
     */
    saveEpisodePosition(episodeId, time, meta = {}) {
        this.saveVideoProgress(episodeId, time, 0, meta);
    }

    /**
     * 获取系列中当前观看到的剧集
     * @param {string} seriesId - 系列ID
     * @returns {Object|null} - 最近观看的剧集信息
     */
    getSeriesCurrentEpisode(seriesId) {
        if (!seriesId) return null;
        
        // 查找该系列的所有进度记录
        const episodes = Object.entries(this.progressData)
            .filter(([_, data]) => data.seriesId === seriesId)
            .sort((a, b) => b[1].lastUpdated - a[1].lastUpdated);
        
        if (episodes.length === 0) return null;
        
        const [episodeId, data] = episodes[0];
        return {
            episodeId,
            episodeNumber: data.episodeNumber,
            progress: data.time
        };
    }

    /**
     * 清除指定视频的播放进度
     * @param {string} videoId - 视频ID
     */
    clearProgress(videoId) {
        if (videoId && this.progressData[videoId]) {
            delete this.progressData[videoId];
            this.saveProgress();
        }
        // 同时从最近观看中移除
        this.recentWatch = this.recentWatch.filter(r => r.id !== videoId);
        this.saveRecentWatch();
    }

    /**
     * 清除所有播放进度
     */
    clearAllProgress() {
        this.progressData = {};
        this.recentWatch = [];
        this.saveProgress();
        this.saveRecentWatch();
    }
}

/**
 * 视频播放器管理类
 * 使用 Artplayer 内置功能实现选集
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
        /** @type {ProgressManager} */
        this.progress = new ProgressManager();
        /** @type {string|null} */
        this.currentSeriesId = null;
        /** @type {string|null} */
        this.currentEpisodeId = null;
        /** @type {Array} 剧集列表 */
        this.episodes = [];
        /** @type {number} 当前剧集索引 */
        this.currentEpisodeIndex = -1;
        /** @type {Function} 关闭回调函数 */
        this.onClose = null;
        /** @type {Function} 剧集切换回调 */
        this.onEpisodeChange = null;
    }

    /**
     * 初始化播放器
     * @param {HTMLElement} container - 容器元素
     * @param {VideoItem} videoData - 视频数据
     * @param {Object} options - 可选参数
     * @param {string} options.seriesId - 系列ID
     * @param {string} options.episodeId - 剧集ID
     * @param {number} options.startTime - 开始播放时间
     * @param {Array} options.episodes - 剧集列表
     * @param {Function} options.onClose - 关闭回调
     * @param {Function} options.onEpisodeChange - 剧集切换回调
     * @returns {Promise<any>}
     */
    async initPlayer(container, videoData, options = {}) {
        this.destroy();
        this.currentVideo = videoData;
        this.currentSeriesId = options.seriesId || null;
        this.currentEpisodeId = options.episodeId || null;
        this.episodes = options.episodes || [];
        this.currentEpisodeIndex = this.episodes.findIndex(ep => ep.id === this.currentEpisodeId);
        if (this.currentEpisodeIndex === -1) this.currentEpisodeIndex = 0;
        this.onClose = options.onClose || null;
        this.onEpisodeChange = options.onEpisodeChange || null;
        this.onEnded = options.onEnded || null;
        this.onPrev = options.onPrev || null;
        this.onNext = options.onNext || null;
        this.isInfinite = options.isInfinite || false;

        if (typeof Artplayer === 'undefined') {
            throw new Error('ArtPlayer未加载');
        }

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
                m3u8: function (video, url) {
                    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                        const hls = new Hls();
                        hls.loadSource(url);
                        hls.attachMedia(video);
                    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                        video.src = url;
                    }
                }
            },
            // 使用 setting 配置选集列表
            settings: this.episodes && this.episodes.length > 0 ? [
                {
                    html: '选集',
                    icon: '<i class="fas fa-list"></i>',
                    selector: this.episodes.map((episode, index) => ({
                        html: episode.title || `第${index + 1}集`,
                        index: index,
                        default: index === this.currentEpisodeIndex
                    })),
                    onSelect: (item, $dom, event) => {
                        // 切换剧集
                        if (this.onEpisodeChange && this.episodes[item.index]) {
                            this.onEpisodeChange(this.episodes[item.index], item.index);
                        }
                        return item.html;
                    }
                }
            ] : [],
            // 添加上一集/下一集控件
            controls: [
                {
                    name: 'last',
                    index: 5,
                    position: 'left',
                    html: `<i class="art-icon">
                            <svg width="22" height="22" viewBox="0 0 16 16">
                                <path d="M4 4a.5.5 0 0 1 1 0v3.248l6.267-3.636c.54-.313 1.232.066 1.232.696v7.384c0 .63-.692 1.01-1.232.697L5 8.753V12a.5.5 0 0 1-1 0V4z"/>
                            </svg>
                        </i>`,
                    tooltip: '上一个视频',
                    click: () => this.playPrevEpisode()
                }, {
                    name: 'next',
                    index: 20,
                    position: 'left',
                    html: `<i class="art-icon">
                            <svg width="22" height="22" viewBox="0 0 16 16">
                                <path d="M12.5 4a.5.5 0 0 0-1 0v3.248L5.233 3.612C4.693 3.3 4 3.678 4 4.308v7.384c0 .63.692 1.01 1.233.697L11.5 8.753V12a.5.5 0 0 0 1 0V4z"/>
                            </svg>
                        </i>`,
                    tooltip: '下一个视频',
                    click: () => this.playNextEpisode()
                }
            ]
        });

        // 如果有开始时间，跳转到对应位置
        if (options.startTime) {
            this.player.on('video:loadedmetadata', () => {
                this.player.currentTime = options.startTime;
                this.player.play();
            });
        } else {
            this.player.on('video:loadedmetadata', () => {
                this.player.play();
            });
        }

        // 监听播放进度，保存到localStorage
        let lastSaveTime = 0;
        this.player.on('video:timeupdate', () => {
            const currentTime = this.player.currentTime;
            // 每5秒保存一次进度
            if (currentTime - lastSaveTime > 5) {
                if (this.currentEpisodeId) {
                    // 获取当前剧集信息用于保存元数据
                    const currentEp = this.episodes[this.currentEpisodeIndex];
                    this.progress.saveEpisodePosition(this.currentEpisodeId, currentTime, {
                        title: this.currentVideo?.title || '',
                        thumbnail: this.currentVideo?.thumbnail || '',
                        seriesId: this.currentSeriesId,
                        seriesTitle: this.currentVideo?.title?.split(' - ')[0] || this.currentVideo?.title || '',
                        episodeNumber: currentEp?.episodeNumber || this.currentEpisodeIndex + 1,
                        episodeTitle: currentEp?.title || '',
                        source: this.currentVideo?.source || ''
                    });
                }
                lastSaveTime = currentTime;
            }
        });

        // 播放完成，自动播放下一集或触发 onEnded
        this.player.on('video:ended', () => {
            if (this.isInfinite && this.onEnded) {
                // 无限模式：触发 onEnded 回调
                this.onEnded();
            } else {
                // 普通模式：自动播放下一集
                this.playNextEpisode();
            }
        });

        // 无限模式：自动进入网页全屏
        if (this.isInfinite) {
            this.player.once('ready', () => {
                this.player.fullscreenWeb = true;
            });
        }

        return this.player;
    }

    /**
     * 播放上一集
     */
    playPrevEpisode() {
        // 无限模式：使用 onPrev 回调
        if (this.isInfinite && this.onPrev) {
            this.onPrev();
            return;
        }
        // 普通模式：使用剧集列表
        if (this.currentEpisodeIndex > 0 && this.onEpisodeChange) {
            const prevIndex = this.currentEpisodeIndex - 1;
            this.onEpisodeChange(this.episodes[prevIndex], prevIndex);
        }
    }

    /**
     * 播放下一集
     */
    playNextEpisode() {
        // 无限模式：使用 onNext 回调
        if (this.isInfinite && this.onNext) {
            this.onNext();
            return;
        }
        // 普通模式：使用剧集列表
        if (this.episodes && this.currentEpisodeIndex < this.episodes.length - 1 && this.onEpisodeChange) {
            const nextIndex = this.currentEpisodeIndex + 1;
            this.onEpisodeChange(this.episodes[nextIndex], nextIndex);
        }
    }

    /**
     * 播放指定剧集（内部切换，不重新初始化播放器）
     * @param {Object} episode
     * @param {string} proxyUrl - 代理后的播放链接
     */
    async playEpisode(episode, proxyUrl) {
        if (!episode) return;

        const index = this.episodes.findIndex(ep => ep.id === episode.id);
        if (index === -1) return;

        this.currentEpisodeId = episode.id;
        this.currentEpisodeIndex = index;
        this.currentVideo = { ...this.currentVideo, title: episode.title, url: episode.url };

        // 切换视频源
        if (proxyUrl && this.player) {
            this.player.switchUrl(proxyUrl);
            // 更新标题
            this.player.title = `${this.currentVideo.title || ''} - ${episode.title || ''}`;
            // 获取保存的进度
            const savedTime = this.progress.getEpisodePosition(episode.id);
            if (savedTime > 10) {
                this.player.once('video:loadedmetadata', () => {
                    this.player.currentTime = savedTime;
                });
            }

        }
    }

    /**
     * 设置画质列表
     * @param {M3U8Result[]} qualities
     */
    setQualities(qualities) {
        this.qualities = qualities;
        this.currentQualityIndex = 0;

        if (this.player && qualities.length > 0) {
            this.switchQuality(qualities[0], 0);
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

        // 根据skipProxy选项决定是否使用代理
        let videoUrl;
        if (!quality.proxy) {
            // 跳过代理，直接使用原始URL
            videoUrl = quality.url;
        } else {
            // 使用代理
            // 优先使用quality.referrer，如果没有则使用当前视频URL
            const referer = quality.referrer || this.currentVideo.url;
            let url = new URL(location);
            if (quality.format === 'h5') {
                // H5: 使用预配后缀名
                let extname = new URL(quality.url).pathname.split('.').pop() || 'mp4';
                if (extname.includes('/') || extname.length >= 5)
                    extname = 'mp4';
                url.pathname = `/api/proxy/video.${extname}`;
            } else {
                // M3U8使用代理
                url.pathname = `/api/proxy/video.m3u8`;
            }
            url.searchParams.set('url', quality.url);
            url.searchParams.set('source', this.currentVideo.source);
            url.searchParams.set('referer', referer);
            if (quality.proxy == URLProxy.REMOTE)
                url.searchParams.set('proxy', 'remote');
            videoUrl = url.toString();
        }

        try {
            this.player.switchUrl(videoUrl);
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
                // 保存最终进度
                if (this.currentEpisodeId) {
                    const currentTime = this.player.currentTime;
                    const currentEp = this.episodes[this.currentEpisodeIndex];
                    this.progress.saveEpisodePosition(this.currentEpisodeId, currentTime, {
                        title: this.currentVideo?.title || '',
                        thumbnail: this.currentVideo?.thumbnail || '',
                        seriesId: this.currentSeriesId,
                        seriesTitle: this.currentVideo?.title?.split(' - ')[0] || this.currentVideo?.title || '',
                        episodeNumber: currentEp?.episodeNumber || this.currentEpisodeIndex + 1,
                        episodeTitle: currentEp?.title || '',
                        source: this.currentVideo?.source || ''
                    });
                }
                this.player.destroy();
            } catch (error) {
                console.error('销毁播放器失败:', error);
            }
            this.player = null;
        }
        this.currentVideo = null;
        this.qualities = [];
        this.currentQualityIndex = 0;
        this.episodes = [];
        this.currentEpisodeIndex = -1;
        this.currentSeriesId = null;
        this.currentEpisodeId = null;
        this.onClose = null;
        this.onEpisodeChange = null;
    }
}
