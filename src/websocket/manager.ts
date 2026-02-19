import { logInfo, logError, logDebug } from "../utils/logger.ts";

// WebSocket 客户端连接
interface WSClient {
  socket: WebSocket;
  id: string;
  subscriptions: Set<string>;
}

// RPC 消息格式
interface RPCMessage {
  id: string;
  method: string;
  params?: unknown;
}

// RPC 响应格式
interface RPCResponse {
  id: string;
  result?: unknown;
  error?: string;
}

/**
 * WebSocket 管理器
 * 管理客户端连接和消息推送
 */
export class WebSocketManager {
  private clients: Map<string, WSClient> = new Map();
  private clientIdCounter = 0;

  /**
   * 添加新客户端连接
   */
  addClient(socket: WebSocket): string {
    const clientId = `client-${++this.clientIdCounter}`;
    const client: WSClient = {
      socket,
      id: clientId,
      subscriptions: new Set(),
    };

    this.clients.set(clientId, client);
    logInfo(`WebSocket 客户端连接: ${clientId}, 当前连接数: ${this.clients.size}`);

    // 设置消息处理器
    socket.onmessage = (event) => {
      this.handleMessage(clientId, event.data);
    };

    // 设置关闭处理器
    socket.onclose = () => {
      this.removeClient(clientId);
    };

    socket.onerror = (error) => {
      logError(`WebSocket 客户端 ${clientId} 错误:`, error);
    };

    return clientId;
  }

  /**
   * 移除客户端连接
   */
  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      this.clients.delete(clientId);
      logInfo(`WebSocket 客户端断开: ${clientId}, 当前连接数: ${this.clients.size}`);
    }
  }

  /**
   * 处理客户端消息
   */
  private handleMessage(clientId: string, data: string): void {
    try {
      const message: RPCMessage = JSON.parse(data);
      logDebug(`收到 RPC 消息 [${clientId}]:`, message.method);

      const client = this.clients.get(clientId);
      if (!client) return;

      // 处理订阅请求
      if (message.method === "subscribe") {
        const channel = message.params as string