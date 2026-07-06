import type { VideoSourceManager } from "../manager.ts";
import type { DownloadManager } from "../utils/download.ts";
import type { WebSocketRPCServer } from "../websocket/rpc.ts";

export interface ServerContext {
  videoSourceManager: VideoSourceManager;
  downloadManager: DownloadManager;
  rpcServer: WebSocketRPCServer;
}
