/**
 * @typedef {'home'|'search'|'downloads'|'sources'} PageType
 */

/**
 * 视频管理应用主类
 */
class VideoManager {
    constructor() {
        /** @type {APIManager} */
        this.api = new APIManager();
        /** @type {NotificationManager} */
        this.notifications = new NotificationManager();
        /** @type {ThemeManager} */
        this.themeManager = new ThemeManager();
        /** @type {VideoPlayerManager} */
        this.playerManager = new VideoPlayerManager();
        
        /** @type {PageType} */
        this.currentPage = 'home';
        /** @type {VideoSource|null} */
        this.currentSource = null;
        /** @type {string} */
        this.searchQuery = '';
        
        /** @type {Object} */
        this.pagination = {
            home: { current: 1, total: 1 },
            search: { current: 1, total: 1 }
        };
        
        /** @type {number|null} */
        this.downloadInterval = null;
        /** @type {number|null} */
        this.sourceSyncInterval = null;
        /** @type {boolean} */
        this.isInitialized = false;
        
        this.init();
    }
    
    /**
     * 启动源状态同步
     */
    startSourceSync() {
        // 每30秒同步一次源状态
        this.sourceSyncInterval = setInterval(() => {
            this.syncSourceState();
        }, 30000);
    }
    
    /**
     * 同步源状态
     */
    async syncSourceState() {
        try {
            const oldSourceId = this.currentSource ? this.currentSource.id : null;
            await this.loadActiveSource();
            
            // 如果活动源发生变化，重新加载当前页面
            const newSourceId = this.currentSource ? this.currentSource.id : null;
            if (oldSourceId !== newSourceId) {
                console.log(`活动源发生变化: ${oldSourceId} -> ${newSourceId}`);
                await this.reloadCurrentPage();
            }
        } catch (error) {
            console.error('同步源状态失败:', error);
        }
    }
    
    /**
     * 重新加载当前页面
     */
    async reloadCurrentPage() {
        switch (this.currentPage) {
            case 'home':
                await this.loadHomePage(this.pagination.home.current);
                break;
            case 'search':
                await this.loadSearchResults(this.pagination.search.current);
                break;
            case 'sources':
                await this.loadSources();
                break;
            case 'downloads':
                await this.loadDownloads();
                break;
        }
    }
    
    /**
     * 加载URL哈希参数
     */
    loadFromHash() {
        const hash = window.location.hash.substring(1);
        if (!hash) return;
        
        try {
            const params = new URLSearchParams(hash);
            
            // 加载搜索查询
            const searchQuery = params.get('search');
            if (searchQuery) {
                const searchInput = DOMHelper.$('#searchInput');
                if (searchInput) {
                    searchInput.value = decodeURIComponent(searchQuery);
                    this.searchQuery = decodeURIComponent(searchQuery);
                }
            }
            
            // 加载页面状态
            const page = params.get('page');
            if (page && ['home', 'search', 'downloads', 'sources'].includes(page)) {
                this.currentPage = page;
                this.switchPage(page, false); // 不更新哈希
            }
            
            // 加载页码
            const pageNum = params.get('pageNum');
            if (pageNum && !isNaN(parseInt(pageNum))) {
                const pageNumInt = parseInt(pageNum);
                if (this.currentPage === 'home') {
                    this.pagination.home.current = pageNumInt;
                } else if (this.currentPage === 'search') {
                    this.pagination.search.current = pageNumInt;
                }
            }
        } catch (error) {
            console.error('加载哈希参数失败:', error);
        }
    }
    
    /**
     * 保存状态到URL哈希
     */
    saveToHash() {
        const params = new URLSearchParams();
        
        // 保存当前页面
        params.set('page', this.currentPage);
        
        // 保存搜索查询
        if (this.searchQuery && this.currentPage === 'search') {
            params.set('search', encodeURIComponent(this.searchQuery));
        }
        
        // 保存页码
        if (this.currentPage === 'home') {
            params.set('pageNum', this.pagination.home.current.toString());
        } else if (this.currentPage === 'search') {
            params.set('pageNum', this.pagination.search.current.toString());
        }
        
        window.location.hash = params.toString();
    }
    
    /**
     * 初始化应用
     */
    async init() {
        try {
            // 等待DOM加载完成
            if (document.readyState === 'loading') {
                await new Promise(resolve => {
                    document.addEventListener('DOMContentLoaded', resolve);
                });
            }
            
            this.bindEvents();
            await this.loadActiveSource();
            
            // 启动源状态同步定时器（每隔30秒同步一次）
            this.startSourceSync();
            
            // 设置应用已初始化标志，以便哈希路由可以正常工作
            this.isInitialized = true;
            
            // 加载URL哈希参数
            this.loadFromHash();
            
            await this.loadHomePage();
            this.startDownloadMonitoring();
            
            // 健康检查
            try {
                await this.api.healthCheck();
                console.log('API服务正常');
            } catch (error) {
                this.notifications.error('API服务连接失败');
            }
        } catch (error) {
            console.error('应用初始化失败:', error);
            this.notifications.error('应用初始化失败');
        }
    }
    
    /**
     * 绑定事件监听器
     */
    bindEvents() {
        // 导航菜单
        const navItems = DOMHelper.$$('.nav-item');
        navItems.forEach(item => {
            DOMHelper.on(item, 'click', (e) => {
                e.preventDefault();
                const page = item.dataset.page;
                if (page) {
                    this.switchPage(page);
                }
            });
        });
        
        // 搜索功能
        const searchBtn = DOMHelper.$('#searchBtn');
        const searchInput = DOMHelper.$('#searchInput');
        
        if (searchBtn) {
            DOMHelper.on(searchBtn, 'click', () => this.performSearch());
        }
        
        if (searchInput) {
            DOMHelper.on(searchInput, 'keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.performSearch();
                }
            });
        }
        
        // 模态框控制
        this.bindModalEvents();
        
        // 下载控制
        this.bindDownloadEvents();
        
        // 移动端支持
        this.bindMobileEvents();
        
        // 键盘快捷键
        this.bindKeyboardEvents();
    }
    
    /**
     * 绑定模态框事件
     */
    bindModalEvents() {
        const modalClose = DOMHelper.$('#modalClose');
        const videoModal = DOMHelper.$('#videoModal');
        
        if (modalClose) {
            DOMHelper.on(modalClose, 'click', () => {
                this.closeVideoModal();
            });
        }
        
        if (videoModal) {
            DOMHelper.on(videoModal, 'click', (e) => {
                if (e.target === videoModal) {
                    this.closeVideoModal();
                }
            });
        }
        
        // 复制链接按钮
        const copyLinkBtn = DOMHelper.$('#copyLinkBtn');
        if (copyLinkBtn) {
            DOMHelper.on(copyLinkBtn, 'click', () => {
                this.copyCurrentVideoLink();
            });
        }
    }
    
    /**
     * 绑定下载相关事件
     */
    bindDownloadEvents() {
        const clearCompletedBtn = DOMHelper.$('#clearCompletedBtn');
        const refreshDownloadsBtn = DOMHelper.$('#refreshDownloadsBtn');
        
        if (clearCompletedBtn) {
            DOMHelper.on(clearCompletedBtn, 'click', () => {
                this.clearCompletedDownloads();
            });
        }
        
        if (refreshDownloadsBtn) {
            DOMHelper.on(refreshDownloadsBtn, 'click', () => {
                this.loadDownloads();
            });
        }
    }
    
    /**
     * 绑定移动端事件
     */
    bindMobileEvents() {
        if (window.innerWidth <= 768) {
            const sidebar = DOMHelper.$('#sidebar');
            const mainContent = DOMHelper.$('#mainContent');
            
            if (sidebar && mainContent) {
                DOMHelper.on(mainContent, 'click', () => {
                    sidebar.classList.remove('show');
                });
            }
        }
    }
    
    /**
     * 绑定键盘事件
     */
    bindKeyboardEvents() {
        DOMHelper.on(document, 'keydown', (e) => {
            // ESC 关闭模态框
            if (e.key === 'Escape') {
                const modal = DOMHelper.$('#videoModal');
                if (modal && !modal.classList.contains('hidden')) {
                    this.closeVideoModal();
                }
            }
            
            // Ctrl/Cmd + K 聚焦搜索框
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                const searchInput = DOMHelper.$('#searchInput');
                if (searchInput) {
                    searchInput.focus();
                    searchInput.select();
                }
            }
            
            // 数字键快速切换页面
            if (e.key >= '1' && e.key <= '4' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const pages = ['home', 'search', 'downloads', 'sources'];
                const pageIndex = parseInt(e.key) - 1;
                
                if (pageIndex < pages.length && document.activeElement.tagName !== 'INPUT') {
                    this.switchPage(pages[pageIndex]);
                }
            }
        });
    }
    
    /**
     * 切换页面
     * @param {PageType} page
     * @param {boolean} updateHash 是否更新哈希（默认true）
     */
    switchPage(page, updateHash = true) {
        if (!this.isInitialized) return;
        
        // 更新导航状态
        DOMHelper.$$('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        
        const activeNavItem = DOMHelper.$(`[data-page="${page}"]`);
        if (activeNavItem) {
            activeNavItem.classList.add('active');
        }
        
        // 切换页面内容
        DOMHelper.$$('.page-content').forEach(content => {
            DOMHelper.hide(content);
        });
        
        const targetPage = DOMHelper.$(`#${page}Page`);
        if (targetPage) {
            DOMHelper.show(targetPage);
        }
        
        this.currentPage = page;
        
        // 更新URL哈希
        if (updateHash) {
            this.saveToHash();
        }
        
        // 加载页面数据
        this.loadPageData(page);
    }
    
    /**
     * 加载页面数据
     * @param {PageType} page
     */
    async loadPageData(page) {
        try {
            switch (page) {
                case 'home':
                    await this.loadHomePage();
                    break;
                case 'search':
                    if (this.searchQuery) {
                        await this.loadSearchResults();
                    }
                    break;
                case 'downloads':
                    await this.loadDownloads();
                    break;
                case 'sources':
                    await this.loadSources();
                    break;
            }
        } catch (error) {
            console.error(`加载${page}页面数据失败:`, error);
            this.notifications.error(`加载页面数据失败: ${error.message}`);
        }
    }
    
    /**
     * 加载活动视频源
     */
    async loadActiveSource() {
        try {
            const activeSource = await this.api.getActiveSource();
            this.currentSource = activeSource;
            this.updateCurrentSourceDisplay();
        } catch (error) {
            console.log('No active source set');
            this.currentSource = null;
            this.updateCurrentSourceDisplay();
        }
    }
    
    /**
     * 更新当前视频源显示
     */
    updateCurrentSourceDisplay() {
        const currentSourceEl = DOMHelper.$('#currentSource');
        const activeSourceNameEl = DOMHelper.$('#activeSourceName');
        
        const sourceName = this.currentSource ? this.currentSource.name : '未选择视频源';
        
        if (currentSourceEl) {
            currentSourceEl.textContent = sourceName;
        }
        
        if (activeSourceNameEl) {
            activeSourceNameEl.textContent = this.currentSource ? this.currentSource.name : '无';
        }
    }
    
    /**
     * 加载视频源列表
     */
    async loadSources() {
        try {
            this.showLoading();
            const data = await this.api.getSources();
            this.renderSources(data || []);
        } catch (error) {
            this.notifications.error('加载视频源失败');
            console.error('Load sources error:', error);
        } finally {
            this.hideLoading();
        }
    }
    
    /**
     * 渲染视频源列表
     * @param {VideoSource[]} sources
     */
    renderSources(sources) {
        const sourcesList = DOMHelper.$('#sourcesList');
        if (!sourcesList) return;
        
        sourcesList.innerHTML = '';
        
        if (sources.length === 0) {
            sourcesList.innerHTML = '<div class="text-center">暂无视频源</div>';
            return;
        }
        
        sources.forEach(source => {
            const isActive = this.currentSource && this.currentSource.id === source.id;
            const sourceItem = DOMHelper.create('div', 
                `source-item ${isActive ? 'active' : ''}`,
                `
                <div class="source-name">${source.name}</div>
                <div class="source-url">${source.baseUrl}</div>
                <div class="source-actions">
                    <button class="btn ${isActive ? 'btn-success' : 'btn-primary'} btn-small" 
                            data-source-id="${source.id}"
                            ${isActive ? 'disabled' : ''}>
                        ${isActive ? '当前源' : '选择'}
                    </button>
                </div>
                `
            );
            
            // 绑定整个卡片点击事件
            if (!isActive) {
                DOMHelper.on(sourceItem, 'click', (e) => {
                    // 防止按钮点击事件冒泡
                    if (e.target.tagName !== 'BUTTON') {
                        this.setActiveSource(source.id);
                    }
                });
                
                // 添加鼠标悬停效果
                sourceItem.style.cursor = 'pointer';
                sourceItem.title = '点击切换视频源';
            }
            
            // 绑定选择按钮事件
            const selectBtn = sourceItem.querySelector('button');
            if (selectBtn && !selectBtn.disabled) {
                DOMHelper.on(selectBtn, 'click', () => {
                    this.setActiveSource(source.id);
                });
            }
            
            sourcesList.appendChild(sourceItem);
        });
    }
    
    /**
     * 设置活动视频源
     * @param {string} source
     */
    async setActiveSource(source) {
        try {
            this.showLoading();
            await this.api.setActiveSource(source);
            this.notifications.success('视频源切换成功');
            
            await this.loadActiveSource();
            await this.loadSources();
            
            // 重新加载当前页面数据并刷新页面
            await this.reloadCurrentPage();
            
            // 更新URL哈希
            this.saveToHash();
            
            // 如果是搜索页面，重新执行搜索
            if (this.currentPage === 'search' && this.searchQuery) {
                await this.performSearch();
            }
        } catch (error) {
            this.notifications.error('切换视频源失败');
            console.error('Set active source error:', error);
        } finally {
            this.hideLoading();
        }
    }
    
    /**
     * 加载首页视频
     * @param {number} page
     */
    async loadHomePage(page = 1) {
        if (!this.currentSource) {
            const homeVideoGrid = DOMHelper.$('#homeVideoGrid');
            if (homeVideoGrid) {
                homeVideoGrid.innerHTML = '<div class="text-center">请先选择视频源</div>';
            }
            return;
        }
        
        try {
            this.showLoading();
            const data = await this.api.getHomeVideos(page);
            this.renderVideoGrid(data.videos || [], 'homeVideoGrid');
            this.renderPagination(data, 'home', 'homePagination');
            this.pagination.home = { 
                current: data.currentPage || 1, 
                total: data.totalPages || 1 
            };
        } catch (error) {
            this.notifications.error('加载首页视频失败');
            const homeVideoGrid = DOMHelper.$('#homeVideoGrid');
            if (homeVideoGrid) {
                homeVideoGrid.innerHTML = '<div class="text-center">加载失败，请检查网络连接</div>';
            }
        } finally {
            this.hideLoading();
        }
    }
    
    /**
     * 执行搜索
     */
    async performSearch() {
        const searchInput = DOMHelper.$('#searchInput');
        if (!searchInput) return;
        
        const query = searchInput.value.trim();
        
        if (!query) {
            this.notifications.warning('请输入搜索关键词');
            return;
        }
        
        if (!this.currentSource) {
            this.notifications.warning('请先选择视频源');
            return;
        }
        
        this.searchQuery = query;
        this.switchPage('search');
        this.saveToHash(); // 保存搜索状态到哈希
        await this.loadSearchResults();
    }
    
    /**
     * 加载搜索结果
     * @param {number} page
     */
    async loadSearchResults(page = 1) {
        if (!this.searchQuery || !this.currentSource) return;
        
        try {
            this.showLoading();
            const data = await this.api.searchVideos(this.searchQuery, page);
            this.renderVideoGrid(data.videos || [], 'searchVideoGrid');
            this.renderPagination(data, 'search', 'searchPagination');
            this.pagination.search = { 
                current: data.currentPage || 1, 
                total: data.totalPages || 1 
            };
        } catch (error) {
            this.notifications.error('搜索失败');
            const searchVideoGrid = DOMHelper.$('#searchVideoGrid');
            if (searchVideoGrid) {
                searchVideoGrid.innerHTML = '<div class="text-center">搜索失败，请重试</div>';
            }
        } finally {
            this.hideLoading();
        }
    }
    
    /**
     * 渲染视频网格
     * @param {VideoItem[]} videos
     * @param {string} containerId
     */
    renderVideoGrid(videos, containerId) {
        const container = DOMHelper.$(`#${containerId}`);
        if (!container) return;
        
        container.innerHTML = '';
        
        if (!videos || videos.length === 0) {
            container.innerHTML = '<div class="text-center">暂无视频</div>';
            return;
        }
        
        videos.forEach(video => {
            const videoCard = this.createVideoCard(video);
            container.appendChild(videoCard);
        });
    }
    
    /**
     * 创建视频卡片
     * @param {VideoItem} video
     * @returns {HTMLElement}
     */
    createVideoCard(video) {
        const card = DOMHelper.create('div', 'video-card');
        
        // 处理缩略图
        const thumbnailUrl = video.thumbnail ? 
            this.api.getImageProxyUrl(video.thumbnail, video.source) : 
            this.getDefaultThumbnail();
        
        card.innerHTML = `
            <div class="video-thumbnail">
                <img src="${thumbnailUrl}" 
                     alt="${video.title}" 
                     loading="lazy"
                     onerror="this.src='${this.getDefaultThumbnail()}'">
                <div class="video-duration">${video.duration || '未知'}</div>
                <div class="video-actions-overlay">
                    <button class="btn btn-large btn-primary video-preview-btn" title="预览">
                        <i class="fas fa-play"></i>
                    </button>
                    <button class="btn btn-large btn-success video-download-btn" title="直接下载">
                        <i class="fas fa-download"></i>
                    </button>
                </div>
            </div>
            <div class="video-info">
                <div class="video-title">${video.title}</div>
                <div class="video-meta">来源: ${video.source}</div>
            </div>
        `;
        
        // 绑定预览按钮点击事件
        const previewBtn = card.querySelector('.video-preview-btn');
        if (previewBtn) {
            DOMHelper.on(previewBtn, 'click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡
                this.showVideoModal(video);
            });
        }
        
        // 绑定下载按钮点击事件
        const downloadBtn = card.querySelector('.video-download-btn');
        if (downloadBtn) {
            DOMHelper.on(downloadBtn, 'click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡
                this.directDownload(video);
            });
        }
        
        // 绑定卡片点击事件（预览）
        DOMHelper.on(card, 'click', () => {
            this.showVideoModal(video);
        });
        
        return card;
    }
    
    /**
     * 获取默认缩略图
     * @returns {string}
     */
    getDefaultThumbnail() {
        return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZGRkIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPuaXoOe8qeedgOWbvueJhzwvdGV4dD48L3N2Zz4=';
    }
    
    /**
     * 显示视频详情模态框
     * @param {VideoItem} video
     */
    async showVideoModal(video) {
        const modal = DOMHelper.$('#videoModal');
        const modalTitle = DOMHelper.$('#modalTitle');
        const videoPlayer = DOMHelper.$('#videoPlayer');
        const videoDetailInfo = DOMHelper.$('#videoDetailInfo');
        const qualitySelection = DOMHelper.$('#qualitySelection');
        const downloadBtn = DOMHelper.$('#downloadVideoBtn');
        
        if (!modal || !modalTitle || !videoPlayer || !videoDetailInfo || !qualitySelection) {
            this.notifications.error('模态框元素未找到');
            return;
        }
        
        modalTitle.textContent = video.title;
        
        // 显示视频基本信息
        videoDetailInfo.innerHTML = `
            <div class="video-info-item">
                <span class="video-info-label">标题:</span>
                <span class="video-info-value">${video.title}</span>
            </div>
            <div class="video-info-item">
                <span class="video-info-label">时长:</span>
                <span class="video-info-value">${video.duration || '未知'}</span>
            </div>
            <div class="video-info-item">
                <span class="video-info-label">来源:</span>
                <span class="video-info-value">${video.source}</span>
            </div>
            <div class="video-info-item">
                <span class="video-info-label">链接:</span>
                <span class="video-info-value" style="word-break: break-all;">${video.url}</span>
            </div>
        `;
        
        // 清空质量选择和播放器
        qualitySelection.innerHTML = '';
        videoPlayer.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #666;">正在解析视频...</div>';
        
        DOMHelper.show(modal);
        
        // 解析视频链接
        try {
            this.showLoading();
            const parseResult = await this.api.parseVideo(video.url, video.source);
            
            // 根据实际返回的数据结构处理
            const results = parseResult.results || [];
            
            if (results && results.length > 0) {
                // 渲染质量选择
                this.renderQualitySelection(results);
                
                // 初始化播放器
                await this.playerManager.initPlayer(videoPlayer, video);
                this.playerManager.setQualities(results);
                
                // 绑定下载按钮
                if (downloadBtn) {
                    // 移除之前的事件监听器
                    const newDownloadBtn = downloadBtn.cloneNode(true);
                    downloadBtn.parentNode.replaceChild(newDownloadBtn, downloadBtn);
                    
                    DOMHelper.on(newDownloadBtn, 'click', () => {
                        const selectedQuality = this.getSelectedQuality();
                        if (selectedQuality) {
                            this.downloadVideo(video.title, selectedQuality.url);
                        } else {
                            this.notifications.warning('请选择视频质量');
                        }
                    });
                }
            } else {
                videoPlayer.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #666;">无法获取视频播放链接</div>';
                this.notifications.error('无法解析视频');
            }
        } catch (error) {
            console.error('Parse video error:', error);
            videoPlayer.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #666;">解析视频失败</div>';
            this.notifications.error(`解析视频失败: ${error.message}`);
        } finally {
            this.hideLoading();
        }
    }
    
    /**
     * 渲染画质选择
     * @param {M3U8Result[]} qualities
     */
    renderQualitySelection(qualities) {
        const qualitySelection = DOMHelper.$('#qualitySelection');
        if (!qualitySelection) return;
        
        qualitySelection.innerHTML = `
            <h4>选择画质</h4>
            <div class="quality-options" id="qualityOptions"></div>
        `;
        
        const qualityOptions = DOMHelper.$('#qualityOptions');
        if (!qualityOptions) return;
        
        qualities.forEach((quality, index) => {
            const option = DOMHelper.create('div', 
                `quality-option ${index === 0 ? 'active' : ''}`,
                `
                <div class="quality-info">
                    <div class="quality-name">${quality.quality || '标清'}</div>
                    <div class="quality-resolution">${quality.resolution || '未知分辨率'}</div>
                </div>
                <div class="quality-bandwidth">${Utils.formatBandwidth(quality.bandwidth)}</div>
                `
            );
            
            DOMHelper.on(option, 'click', () => {
                // 移除其他选项的active状态
                DOMHelper.$$('.quality-option').forEach(opt => {
                    opt.classList.remove('active');
                });
                
                // 添加当前选项的active状态
                option.classList.add('active');
                
                // 切换播放器质量
                this.playerManager.switchQuality(quality, index);
            });
            
            qualityOptions.appendChild(option);
        });
    }
    
    /**
     * 获取选中的画质
     * @returns {M3U8Result|null}
     */
    getSelectedQuality() {
        return this.playerManager.getCurrentQuality();
    }
    
    /**
     * 关闭视频模态框
     */
    closeVideoModal() {
        const modal = DOMHelper.$('#videoModal');
        if (modal) {
            DOMHelper.hide(modal);
        }
        this.playerManager.destroy();
    }
    
    /**
     * 复制当前视频链接
     */
    async copyCurrentVideoLink() {
        const selectedQuality = this.getSelectedQuality();
        if (!selectedQuality) {
            this.notifications.warning('请先选择视频质量');
            return;
        }
        
        const proxyUrl = window.location.origin + this.api.getProxyUrl(selectedQuality.url, this.playerManager.currentVideo.source);
        
        const success = await Utils.copyToClipboard(proxyUrl);
        if (success) {
            this.notifications.success('链接已复制到剪贴板');
        } else {
            this.notifications.error('复制失败');
        }
    }
    
    /**
     * 下载视频
     * @param {string} title
     * @param {string} m3u8Url
     */
    async downloadVideo(title, m3u8Url) {
        try {
            const download = await this.api.createDownload(title, m3u8Url, undefined, this.playerManager.currentVideo.url);
            await this.api.startDownload(download.task.id);
            this.notifications.success('下载任务已创建');
            this.updateDownloadBadge();
        } catch (error) {
            this.notifications.error(`创建下载任务失败: ${error.message}`);
        }
    }
    
    /**
     * 加载下载列表
     */
    async loadDownloads() {
        try {
            const data = await this.api.getDownloads();
            // 修复：使用正确的属性名tasks而不是downloads（适配后端返回格式）
            this.renderDownloadList(data.tasks || []);
            this.updateDownloadBadge();
        } catch (error) {
            this.notifications.error('加载下载列表失败');
            console.error('Failed to load downloads:', error);
        }
    }
    
    /**
     * 渲染下载列表
     * @param {DownloadTask[]} downloads
     */
    renderDownloadList(downloads) {
        const container = DOMHelper.$('#downloadList');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (!downloads || downloads.length === 0) {
            container.innerHTML = '<div class="text-center">暂无下载任务</div>';
            return;
        }
        
        downloads.forEach(download => {
            const downloadItem = this.createDownloadItem(download);
            container.appendChild(downloadItem);
        });
    }
    
    /**
     * 创建下载项
     * @param {DownloadTask} download
     * @returns {HTMLElement}
     */
    createDownloadItem(download) {
        const item = DOMHelper.create('div', 'download-item');
        const progress = download.progress || 0;
        
        item.innerHTML = `
            <div class="download-info">
                <div class="download-title">${download.title}</div>
                <div class="download-progress">
                    <div class="progress-bar">
                        <div class="progress-fill ${this.getProgressClass(download)}" style="width: ${progress}%"></div>
                    </div>
                    <span>${progress.toFixed(2)}%</span>
                </div>
                <div class="download-status">
                    ${this.getStatusText(download.status)} 
                    ${download.speed ? `- ${download.speed}` : ''}
                </div>
            </div>
            <div class="download-actions">
                ${this.getDownloadActions(download)}
            </div>
        `;
        
        // 绑定操作按钮事件
        const actionBtn = item.querySelector('.download-actions button');
        if (actionBtn) {
            const action = actionBtn.dataset.action;
            const downloadId = download.id;
            
            if (action === 'cancel') {
                DOMHelper.on(actionBtn, 'click', () => this.cancelDownload(downloadId));
            } else if (action === 'retry') {
                DOMHelper.on(actionBtn, 'click', () => this.retryDownload(downloadId));
            } else if (action === 'start') {
                DOMHelper.on(actionBtn, 'click', () => this.startDownload(downloadId));
            }
        }
        
        return item;
    }
    
    /**
     * 获取进度条样式
     * @param {DownloadTask} download
     * @returns {string}
     */
    getProgressClass(download) {
        switch (download.status) {
            case 'downloading':
                return 'progress-bar-striped progress-bar-animated';
            case 'completed':
                return 'bg-success';
            case 'error':
            case 'cancelled':
                return 'bg-danger';
            default:
                return 'bg-secondary';
        }
    }
    
    /**
     * 获取状态文本
     * @param {string} status
     * @returns {string}
     */
    getStatusText(status) {
        const statusMap = {
            'created': '已创建',
            'pending': '等待中',
            'downloading': '下载中',
            'completed': '已完成',
            'error': '失败',
            'cancelled': '已取消'
        };
        return statusMap[status] || status;
    }
    
    /**
     * 获取下载操作按钮
     * @param {DownloadTask} download
     * @returns {string}
     */
    getDownloadActions(download) {
        switch (download.status) {
            case 'downloading':
                return `<button class="btn btn-danger btn-small" data-action="cancel">
                    <i class="fas fa-stop"></i> 取消
                </button>`;
            case 'error':
                return `<button class="btn btn-primary btn-small" data-action="retry">
                    <i class="fas fa-redo"></i> 重试
                </button>`;
            case 'completed':
                return `<button class="btn btn-success btn-small" disabled>
                    <i class="fas fa-check"></i> 已完成
                </button>`;
            case 'created':
            case 'pending':
                return `<button class="btn btn-primary btn-small" data-action="start">
                    <i class="fas fa-play"></i> 开始
                </button>`;
            default:
                return '';
        }
    }
    
    /**
     * 开始下载
     * @param {string} id
     */
    async startDownload(id) {
        try {
            await this.api.startDownload(id);
            this.notifications.success('下载已开始');
            await this.loadDownloads();
        } catch (error) {
            this.notifications.error('开始下载失败');
            console.error('Start download error:', error);
        }
    }
    
    /**
     * 取消下载
     * @param {string} id
     */
    async cancelDownload(id) {
        try {
            await this.api.cancelDownload(id);
            this.notifications.success('下载已取消');
            await this.loadDownloads();
        } catch (error) {
            this.notifications.error('取消下载失败');
        }
    }
    
    /**
     * 重试下载
     * @param {string} id
     */
    async retryDownload(id) {
        try {
            // 由于后端可能没有实现重试API，我们改为重新开始下载
            await this.api.startDownload(id);
            this.notifications.success('下载已重新开始');
            await this.loadDownloads();
        } catch (error) {
            this.notifications.error('重试下载失败');
            console.error('Retry download error:', error);
        }
    }
    
    /**
     * 清除已完成的下载
     */
    async clearCompletedDownloads() {
        try {
            // 调用API清除后端已完成下载
            const result = await this.api.clearCompletedDownloads();
            
            if (result.success) {
                // 重新加载下载列表以更新前端
                await this.loadDownloads();
                this.notifications.success('已清除所有完成的下载任务');
            } else {
                this.notifications.warning('没有已完成的下载任务可清除');
            }
        } catch (error) {
            console.error('清除已完成下载失败:', error);
            this.notifications.error('清除已完成下载失败');
        }
    }
    
    /**
     * 渲染分页
     * @param {Object} data
     * @param {string} type
     * @param {string} containerId
     */
    renderPagination(data, type, containerId) {
        const container = DOMHelper.$(`#${containerId}`);
        if (!container) return;
        
        const { currentPage = 1, totalPages = 1 } = data;
        
        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }
        
        let paginationHTML = '';
        
        // 添加页码跳转输入框
        paginationHTML += `
            <div class="pagination-info">
                <div class="page-info">
                    <span>当前第 ${currentPage} 页，共 ${totalPages} 页</span>
                </div>
                <div class="page-jump">
                    <span>跳转到第</span>
                    <input type="number" min="1" max="${totalPages}" id="pageJumpInput" value="${currentPage}" class="page-jump-input">
                    <button class="page-jump-btn" id="pageJumpBtn">确定</button>
                    <span>页</span>
                </div>
            </div>
            <div class="pagination-controls">
        `;
        
        // 上一页
        paginationHTML += `
            <button ${currentPage <= 1 ? 'disabled' : ''} 
                    onclick="app.goToPage('${type}', ${currentPage - 1})"
                    title="上一页">
                <i class="fas fa-chevron-left"></i>
            </button>
        `;
        
        // 页码显示逻辑 - 改进显示更多页码
        const maxVisiblePages = 7; // 最多显示的页码数
        let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
        let endPage = startPage + maxVisiblePages - 1;
        
        // 调整范围以确保不超过总页数
        if (endPage > totalPages) {
            endPage = totalPages;
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }
        
        // 如果不是从第一页开始，显示第一页和省略号
        if (startPage > 1) {
            paginationHTML += `<button onclick="app.goToPage('${type}', 1)">1</button>`;
            if (startPage > 2) {
                paginationHTML += `<span class="pagination-ellipsis">...</span>`;
            }
        }
        
        // 显示页码范围
        for (let i = startPage; i <= endPage; i++) {
            paginationHTML += `
                <button class="${i === currentPage ? 'current-page' : ''}"
                        onclick="app.goToPage('${type}', ${i})">
                    ${i}
                </button>
            `;
        }
        
        // 如果不是到最后一页，显示省略号和最后一页
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                paginationHTML += `<span class="pagination-ellipsis">...</span>`;
            }
            paginationHTML += `<button onclick="app.goToPage('${type}', ${totalPages})">${totalPages}</button>`;
        }
        
        // 下一页
        paginationHTML += `
            <button ${currentPage >= totalPages ? 'disabled' : ''} 
                    onclick="app.goToPage('${type}', ${currentPage + 1})"
                    title="下一页">
                <i class="fas fa-chevron-right"></i>
            </button>
            </div>
        `;
        
        container.innerHTML = paginationHTML;
        
        // 添加回车键支持和跳转按钮事件
        const pageJumpInput = container.querySelector('#pageJumpInput');
        const pageJumpBtn = container.querySelector('#pageJumpBtn');
        
        if (pageJumpInput) {
            pageJumpInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const page = parseInt(pageJumpInput.value);
                    if (page >= 1 && page <= totalPages) {
                        this.goToPage(type, page);
                    } else {
                        this.notifications.warning(`请输入1到${totalPages}之间的页码`);
                        pageJumpInput.value = currentPage;
                    }
                }
            });
        }
        
        if (pageJumpBtn) {
            pageJumpBtn.addEventListener('click', () => {
                const page = parseInt(pageJumpInput.value);
                if (page >= 1 && page <= totalPages) {
                    this.goToPage(type, page);
                } else {
                    this.notifications.warning(`请输入1到${totalPages}之间的页码`);
                    pageJumpInput.value = currentPage;
                }
            });
        }
    }
    
    /**
     * 跳转到指定页
     * @param {string} type
     * @param {number} page
     */
    async goToPage(type, page) {
        // 确保页码是有效的数字
        const pageNum = parseInt(page);
        if (isNaN(pageNum) || pageNum < 1) {
            this.notifications.warning('请输入有效的页码');
            return;
        }
        
        // 滚动到顶部
        window.scrollTo({ top: 0, behavior: 'smooth' });
        
        if (type === 'home') {
            await this.loadHomePage(pageNum);
        } else if (type === 'search') {
            await this.loadSearchResults(pageNum);
        }
        
        // 更新URL哈希
        this.saveToHash();
    }
    
    /**
     * 开始下载监控
     */
    startDownloadMonitoring() {
        // 清除现有的定时器
        if (this.downloadInterval) {
            clearInterval(this.downloadInterval);
        }
        
        // 每5s更新一次下载状态
        this.downloadInterval = setInterval(async () => {
            if (this.currentPage === 'downloads') {
                await this.loadDownloads();
            } else {
                // 只更新徽章，不重新加载整个列表
                await this.updateDownloadBadge();
            }
        }, 5000);
    }
    
    /**
     * 更新下载徽章
     */
    async updateDownloadBadge() {
        try {
            const data = await this.api.getDownloads();
            // 修复：使用正确的属性名tasks而不是downloads（适配后端返回格式）
            const activeDownloads = data.tasks ? data.tasks.filter(d => 
                d.status === 'downloading' || d.status === 'created'
            ).length : 0;
            
            const badge = DOMHelper.$('#downloadBadge');
            if (badge) {
                badge.textContent = activeDownloads;
                badge.style.display = activeDownloads > 0 ? 'block' : 'none';
            }
        } catch (error) {
            console.error('Failed to update download badge:', error);
        }
    }
    
    /**
     * 显示加载指示器
     */
    showLoading() {
        const loading = DOMHelper.$('#loading');
        if (loading) {
            DOMHelper.show(loading);
        }
    }
    
    /**
     * 隐藏加载指示器
     */
    hideLoading() {
        const loading = DOMHelper.$('#loading');
        if (loading) {
            DOMHelper.hide(loading);
        }
    }


    /**
     * 直接下载视频（无需预览）
     * @param {VideoItem} video
     */
    async directDownload(video) {
        try {
            this.showLoading();
            this.notifications.info(`正在解析视频: ${video.title}`);
            
            // 解析视频链接
            const parseResult = await this.api.parseVideo(video.url, video.source);
            
            // 根据实际返回的数据结构处理
            const results = parseResult.results || [];
            
            if (results && results.length > 0) {
                // 默认选择最高质量
                const highestQuality = results.reduce((prev, current) => {
                    const prevBandwidth = prev.bandwidth || 0;
                    const currentBandwidth = current.bandwidth || 0;
                    return currentBandwidth > prevBandwidth ? current : prev;
                });
                
                // 开始下载
                const download = await this.createDownload(video.title, highestQuality.url, video.url);
                await this.api.startDownload(download.task.id);
                this.notifications.success(`已添加到下载队列: ${video.title}`);
            } else {
                this.notifications.error('无法获取视频下载链接');
            }
        } catch (error) {
            console.error('Direct download error:', error);
            this.notifications.error(`直接下载失败: ${error.message}`);
        } finally {
            this.hideLoading();
        }
    }
    
    /**
     * 创建下载任务
     * @param {string} title
     * @param {string} m3u8Url
     * @param {string} referer
     */
    async createDownload(title, m3u8Url, referer) {
        try {
            const result = await this.api.createDownload(title, m3u8Url, undefined, referer);
            if (result.task) {
                // 如果当前在下载页面，刷新下载列表
                if (this.currentPage === 'downloads') {
                    await this.loadDownloads();
                } else {
                    // 否则只更新徽章
                    await this.updateDownloadBadge();
                }
                return result;
            } else {
                throw new Error('创建下载任务失败');
            }
        } catch (error) {
            console.error('Create download error:', error);
            this.notifications.error(`创建下载任务失败: ${error.message}`);
            throw error;
        }
    }

}

// 全局变量
/** @type {VideoManager|null} */
let app = null;

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    app = new VideoManager();
});

// 全局错误处理
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
    if (app && app.notifications) {
        app.notifications.error('发生未知错误');
    }
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    if (app && app.notifications) {
        app.notifications.error('操作失败');
    }
});

// 响应式处理
window.addEventListener('resize', () => {
    const sidebar = DOMHelper.$('#sidebar');
    if (sidebar && window.innerWidth <= 768) {
        sidebar.classList.remove('show');
    }
});

// 页面可见性变化处理
document.addEventListener('visibilitychange', () => {
    if (!app) return;
    
    if (document.hidden) {
        // 页面隐藏时暂停下载监控
        if (app.downloadInterval) {
            clearInterval(app.downloadInterval);
            app.downloadInterval = null;
        }
    } else {
        // 页面显示时恢复下载监控
        app.startDownloadMonitoring();
    }
});