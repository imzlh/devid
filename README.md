# VDown - 视频下载器

一个基于Deno的视频下载器，支持多源切换、视频搜索、M3U8解析和下载功能。

## 功能特性

- 多视频源支持，可轻松切换不同视频源
- 主页视频浏览
- 视频搜索（支持多页结果）
- M3U8视频链接解析和代理
- 图片代理（支持需要解码的图片）
- 视频下载（使用FFmpeg）
- 现代化的Web界面
- 在线视频播放（支持多种清晰度切换）

## 技术栈

- 后端：Deno + Oak
- 前端：原生HTML/CSS/JavaScript + ArtPlayer
- 下载：FFmpeg（需要系统安装）

## 安装和运行

### 前置要求

1. 安装 [Deno](https://deno.land/)
2. 安装 [FFmpeg](https://ffmpeg.org/)（用于视频下载）

### 运行步骤

1. 克隆或下载项目
2. 在项目目录中运行：

```bash
# 开发模式（自动重启）
deno task dev

# 生产模式
deno task start

# 或者直接运行
deno run -A main.ts
```

3. 打开浏览器访问 `http://localhost:9876`

## 项目结构

```
vdown/
├── deno.json              # Deno配置文件
├── main.ts                # 主入口文件
├── src/
│   ├── sources/           # 视频源实现
│   │   ├── base.ts        # 视频源基类
│   │   ├── gg51.ts        # GG51视频源实现
│   │   └── manager.ts     # 视频源管理器
│   ├── types/             # 类型定义
│   │   └── index.ts
│   ├── utils/             # 工具函数
│   │   ├── m3u8.ts        # M3U8解析工具
│   │   ├── fetch.ts       # 网络请求工具
│   │   ├── download.ts    # 下载管理工具
│   │   ├── logger.ts      # 日志工具
│   │   ├── validation.ts  # 参数验证工具
│   │   └── check.ts       # 检查工具
│   └── server.ts          # 服务器主文件
└── public/                # 前端静态文件
    ├── index.html         # 主页面
    ├── style.css          # 样式文件
    └── app.js             # 前端JavaScript
```

## M3U8处理

应用支持M3U8视频流的解析和下载，具有以下特性：

1. **M3U8解析**：解析M3U8文件，提取不同质量的视频流
2. **代理服务**：通过内置代理服务器处理M3U8和TS文件请求
3. **TS流修复**：自动修复损坏的TS流数据，确保下载完整性
4. **FFmpeg集成**：使用FFmpeg下载和转换M3U8视频流

### M3U8处理流程

1. 解析原始M3U8文件，提取视频流信息
2. 创建代理M3U8内容，用于FFmpeg下载
3. 通过代理服务器处理TS文件请求
4. 使用FFmpeg下载完整视频

## 视频播放

应用集成了ArtPlayer播放器，支持：

1. **多种清晰度切换**：自动解析视频的不同清晰度选项
2. **M3U8流播放**：支持HLS协议的视频流播放
3. **画中画模式**：支持浏览器画中画功能
4. **全屏播放**：支持全屏和网页全屏模式
5. **播放速度控制**：支持调整播放速度
6. **快捷键支持**：支持键盘快捷键控制

## 添加新的视频源

1. 在 `src/sources/` 目录下创建新的视频源类，继承 `BaseVideoSource`
2. 实现必要的方法：
   - `getHomeVideos()`: 获取主页视频列表
   - `searchVideos()`: 搜索视频
   - `parseVideoUrl()`: 解析视频链接获取M3U8
3. 在 `src/sources/manager.ts` 中注册新的视频源

### 示例视频源实现

```typescript
import { BaseVideoSource } from './base.ts';
import { VideoItem, SearchResult, M3U8Result } from '../types/index.ts';

export class MyVideoSource extends BaseVideoSource {
  constructor() {
    super('my-source', '我的视频源', 'https://my-video-site.com');
  }

  async getHomeVideos(): Promise<VideoItem[]> {
    // 实现获取主页视频的逻辑
  }

  async searchVideos(query: string, page: number = 1): Promise<SearchResult> {
    // 实现搜索视频的逻辑
  }

  async parseVideoUrl(url: string): Promise<M3U8Result[]> {
    // 实现解析视频链接的逻辑
  }
}
```

## API接口

### 视频源管理

#### `GET /api/sources`
获取所有可用的视频源列表。

**返回值：**
```json
{
  "sources": [
    {
      "id": "gg51",
      "name": "GG51",
      "baseUrl": "https://gg51.com",
      "isActive": true
    }
  ]
}
```

#### `POST /api/sources/active`
设置当前活动的视频源。

**请求体：**
```json
{
  "id": "gg51"
}
```

**参数说明：**
- `id` (string, 必需): 视频源ID

**返回值：**
```json
{
  "success": true
}
```

#### `GET /api/sources/active`
获取当前活动的视频源信息。

**返回值：**
```json
{
  "id": "gg51",
  "name": "GG51"
}
```

### 视频内容

#### `GET /api/home-videos`
获取主页视频列表。

**查询参数：**
- `page` (number, 可选): 页码，默认为1

**返回值：**
```json
{
  "videos": [
    {
      "id": "12345",
      "title": "视频标题",
      "thumbnail": "缩略图URL",
      "duration": "01:23:45",
      "url": "视频详情页URL",
      "source": "gg51"
    }
  ],
  "currentPage": 1,
  "totalPages": 50
}
```

#### `GET /api/search`
搜索视频。

**查询参数：**
- `q` (string, 必需): 搜索关键词
- `page` (number, 可选): 页码，默认为1

**返回值：**
```json
{
  "videos": [
    {
      "id": "12345",
      "title": "视频标题",
      "thumbnail": "缩略图URL",
      "duration": "01:23:45",
      "url": "视频详情页URL",
      "source": "gg51"
    }
  ],
  "currentPage": 1,
  "totalPages": 10
}
```

#### `POST /api/parse-video`
解析视频链接获取M3U8地址。

**请求体：**
```json
{
  "url": "视频详情页URL"
}
```

**参数说明：**
- `url` (string, 必需): 视频详情页URL

**返回值：**
```json
{
  "results": [
    {
      "url": "M3U8文件URL",
      "quality": "高清",
      "resolution": "1920x1080",
      "bandwidth": 2000000
    }
  ]
}
```

### M3U8处理

#### `GET /api/parse-m3u8`
解析M3U8链接，提取视频流信息。

**查询参数：**
- `url` (string, 必需): M3U8文件URL

**返回值：**
```json
{
  "results": [
    {
      "url": "M3U8文件URL",
      "quality": "高清",
      "resolution": "1920x1080",
      "bandwidth": 2000000
    }
  ]
}
```

#### `GET /api/proxy/:name`
M3U8代理请求，用于处理需要特定Referer的M3U8和TS文件。

**路径参数：**
- `name` (string, 必需): 文件名称，如 playlist.m3u8, segment.ts, key.bin 等

**查询参数：**
- `url` (string, 必需): URL编码后的文件URL
- `referer` (string, 可选): Referer头
- `taskId` (string, 可选): 下载任务ID

**返回值：** 文件内容

### 图片代理

#### `GET /api/image-proxy`
获取需要特殊处理的图片，如需要解码的图片。

**查询参数：**
- `url` (string, 必需): 图片URL
- `source` (string, 必需): 视频源ID，用于设置正确的Referer

**返回值：** 图片数据

### 下载管理

#### `POST /api/downloads`
创建新的下载任务。

**请求体：**
```json
{
  "title": "视频标题",
  "url": "M3U8文件URL",
  "outputPath": "输出文件路径",
  "quality": "视频质量",
  "referer": "引用页URL"
}
```

**参数说明：**
- `title` (string, 必需): 视频标题，用于命名输出文件
- `url` (string, 必需): M3U8文件URL
- `outputPath` (string, 可选): 输出文件路径，默认为下载目录
- `quality` (string, 可选): 视频质量描述
- `referer` (string, 可选): 引用页URL

**返回值：**
```json
{
  "task": {
    "id": "下载任务ID",
    "title": "视频标题",
    "status": "created",
    "progress": 0,
    "createdAt": "2023-01-01T00:00:00.000Z"
  }
}
```

#### `POST /api/downloads/:id/start`
开始执行下载任务。

**路径参数：**
- `id` (string, 必需): 下载任务ID

**返回值：**
```json
{
  "success": true
}
```

#### `GET /api/downloads/:id`
获取指定下载任务的状态和进度。

**路径参数：**
- `id` (string, 必需): 下载任务ID

**返回值：**
```json
{
  "task": {
    "id": "下载任务ID",
    "title": "视频标题",
    "status": "downloading",
    "progress": 45,
    "speed": "1.2MB/s",
    "createdAt": "2023-01-01T00:00:00.000Z",
    "startedAt": "2023-01-01T00:01:00.000Z"
  }
}
```

#### `GET /api/downloads`
获取所有下载任务的列表。

**返回值：**
```json
{
  "tasks": [
    {
      "id": "下载任务ID",
      "title": "视频标题",
      "status": "completed",
      "progress": 100,
      "createdAt": "2023-01-01T00:00:00.000Z",
      "completedAt": "2023-01-01T00:05:00.000Z"
    }
  ]
}
```

#### `POST /api/downloads/:id/cancel`
取消正在执行的下载任务。

**路径参数：**
- `id` (string, 必需): 下载任务ID

**返回值：**
```json
{
  "success": true
}
```

### 其他

#### `GET /api/health`
健康检查接口，用于确认服务是否正常运行。

**返回值：**
```json
{
  "status": "ok",
  "timestamp": "2023-01-01T00:00:00.000Z",
  "uptime": 12345.67
}
```

## 配置

可以通过环境变量配置端口：

```bash
PORT=3000 deno run -A main.ts
```

默认端口为9876。

可以通过环境变量启用详细日志：

```bash
VERBOSE_LOGGING=true deno run -A main.ts
```

## 注意事项

1. 确保FFmpeg已安装并添加到系统PATH
2. 下载目录需要写权限
3. 临时文件（temp目录）会在下载完成后自动清理
4. 本项目仅用于学习和研究目的，请遵守相关法律法规和网站的使用条款
5. 下载视频时请尊重版权，不要用于商业用途
6. 使用图片代理功能时，请遵守目标网站的robots.txt规则

## 许可证

MIT License