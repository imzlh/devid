type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

type PushHandler<T = unknown> = (data: T) => void;

export class RpcClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingCall>();
  private handlers = new Map<string, Set<PushHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  private connectionId = 0;

  connected = false;

  connect(path = "/ws"): void {
    this.closedByUser = false;
    this.connectionId++;
    const connectionId = this.connectionId;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}${path}`;
    this.ws?.close();
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      if (connectionId !== this.connectionId) return;
      this.connected = true;
    };

    this.ws.onmessage = (event) => {
      if (connectionId !== this.connectionId) return;
      this.handleMessage(event.data);
    };

    this.ws.onclose = () => {
      if (connectionId !== this.connectionId) return;
      this.connected = false;
      this.rejectPending(new Error("WebSocket disconnected"));
      if (!this.closedByUser) {
        this.reconnectTimer = setTimeout(() => this.connect(path), 3000);
      }
    };
  }

  disconnect(): void {
    this.closedByUser = true;
    this.connectionId++;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    this.rejectPending(new Error("WebSocket disconnected"));
  }

  call<T>(method: string, params: unknown[] = []): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("WebSocket is not connected"));
    }

    const id = crypto.randomUUID();
    const timeoutId = setTimeout(() => {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      pending.reject(new Error("RPC timeout"));
    }, 30000);

    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId,
      });
    });

    this.ws.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  on<T>(method: string, handler: PushHandler<T>): () => void {
    const set = this.handlers.get(method) ?? new Set<PushHandler>();
    set.add(handler as PushHandler);
    this.handlers.set(method, set);
    return () => set.delete(handler as PushHandler);
  }

  private handleMessage(data: string): void {
    let message: {
      id?: string;
      error?: { message?: string };
      result?: unknown;
      method?: string;
      data?: unknown;
    };
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id)!;
      this.pending.delete(message.id);
      clearTimeout(pending.timeoutId);
      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      const handlers = this.handlers.get(message.method);
      handlers?.forEach((handler) => handler(message.data));
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
