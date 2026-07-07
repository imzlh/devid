import { logDebug, logError, logInfo } from "../utils/logger.ts";

interface WSClient {
  socket: WebSocket;
  id: string;
  subscriptions: Set<string>;
}

interface RPCMessage {
  id?: string;
  method: string;
  params?: unknown;
}

interface RPCResponse {
  id?: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export class WebSocketManager {
  private clients = new Map<string, WSClient>();
  private clientIdCounter = 0;

  addClient(socket: WebSocket): string {
    const clientId = `client-${++this.clientIdCounter}`;
    const client: WSClient = {
      socket,
      id: clientId,
      subscriptions: new Set(),
    };

    this.clients.set(clientId, client);
    logInfo(`WebSocket 客户端连接: ${clientId}, 当前连接数: ${this.clients.size}`);

    socket.onmessage = (event) => {
      this.handleMessage(clientId, event.data);
    };
    socket.onclose = () => {
      this.removeClient(clientId);
    };
    socket.onerror = (error) => {
      logError(`WebSocket 客户端 ${clientId} 错误:`, error);
    };

    return clientId;
  }

  removeClient(clientId: string): void {
    if (this.clients.delete(clientId)) {
      logInfo(`WebSocket 客户端断开: ${clientId}, 当前连接数: ${this.clients.size}`);
    }
  }

  broadcast(channel: string, data: unknown): void {
    const payload = JSON.stringify({ method: channel, data });
    for (const client of this.clients.values()) {
      if (!client.subscriptions.has(channel)) continue;
      if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(payload);
      }
    }
  }

  sendToClient(clientId: string, method: string, data: unknown): boolean {
    const client = this.clients.get(clientId);
    if (!client || client.socket.readyState !== WebSocket.OPEN) return false;
    client.socket.send(JSON.stringify({ method, data }));
    return true;
  }

  getClientCount(): number {
    return this.clients.size;
  }

  private handleMessage(clientId: string, data: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
      const message = JSON.parse(data) as RPCMessage;
      logDebug(`收到 WebSocket 消息 [${clientId}]:`, message.method);

      switch (message.method) {
        case "subscribe": {
          const channel = this.channelParam(message.params);
          if (!channel) {
            this.sendResponse(client, {
              id: message.id,
              error: { code: -32602, message: "Invalid channel" },
            });
            return;
          }
          client.subscriptions.add(channel);
          this.sendResponse(client, { id: message.id, result: { subscribed: channel } });
          return;
        }
        case "unsubscribe": {
          const channel = this.channelParam(message.params);
          if (!channel) {
            this.sendResponse(client, {
              id: message.id,
              error: { code: -32602, message: "Invalid channel" },
            });
            return;
          }
          client.subscriptions.delete(channel);
          this.sendResponse(client, { id: message.id, result: { unsubscribed: channel } });
          return;
        }
        default:
          this.sendResponse(client, {
            id: message.id,
            error: { code: -32601, message: `Method not found: ${message.method}` },
          });
      }
    } catch (error) {
      logError(`处理 WebSocket 消息失败 [${clientId}]:`, error);
      this.sendResponse(client, {
        error: { code: -32700, message: "Parse error" },
      });
    }
  }

  private channelParam(params: unknown): string | null {
    if (typeof params === "string" && params.trim()) return params.trim();
    if (Array.isArray(params) && typeof params[0] === "string" && params[0].trim()) {
      return params[0].trim();
    }
    if (
      params &&
      typeof params === "object" &&
      typeof (params as { channel?: unknown }).channel === "string" &&
      (params as { channel: string }).channel.trim()
    ) {
      return (params as { channel: string }).channel.trim();
    }
    return null;
  }

  private sendResponse(client: WSClient, response: RPCResponse): void {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(JSON.stringify(response));
    }
  }
}
