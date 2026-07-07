import { assertEquals } from "@std/assert";
import { normalizeRpcClientMessage, RpcClient } from "../web/src/api/ws.ts";

Deno.test("normalizeRpcClientMessage rejects malformed websocket payloads", () => {
  assertEquals(normalizeRpcClientMessage("bad json"), null);
  assertEquals(normalizeRpcClientMessage("null"), null);
  assertEquals(normalizeRpcClientMessage("[]"), null);
  assertEquals(normalizeRpcClientMessage("{}"), null);
  assertEquals(normalizeRpcClientMessage('{"id":""}'), null);
  assertEquals(normalizeRpcClientMessage('{"id":"   "}'), null);
  assertEquals(normalizeRpcClientMessage('{"method":""}'), null);
  assertEquals(normalizeRpcClientMessage('{"method":{}}'), null);
});

Deno.test("normalizeRpcClientMessage accepts RPC responses", () => {
  assertEquals(
    normalizeRpcClientMessage('{"id":" 1 ","result":{"ok":true}}'),
    {
      kind: "response",
      id: "1",
      result: { ok: true },
      errorMessage: undefined,
    },
  );
  assertEquals(
    normalizeRpcClientMessage('{"id":"2","error":{"message":" failed "}}'),
    {
      kind: "response",
      id: "2",
      result: undefined,
      errorMessage: "failed",
    },
  );
  assertEquals(
    normalizeRpcClientMessage('{"id":"3","error":true}'),
    {
      kind: "response",
      id: "3",
      result: undefined,
      errorMessage: "RPC error",
    },
  );
});

Deno.test("normalizeRpcClientMessage accepts push messages with string methods", () => {
  assertEquals(
    normalizeRpcClientMessage(
      '{"method":" download:update ","data":[{"id":"task"}]}',
    ),
    {
      kind: "push",
      method: "download:update",
      data: [{ id: "task" }],
    },
  );
});

class FakeWebSocket {
  static latest: FakeWebSocket | null = null;
  static throwOnConstruct = false;
  static throwOnSend = false;

  readyState = WebSocket.OPEN;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    if (FakeWebSocket.throwOnConstruct) {
      throw new Error("construct failed");
    }
    FakeWebSocket.latest = this;
  }

  send(message: string) {
    if (FakeWebSocket.throwOnSend) {
      throw new Error("send failed");
    }
    this.sent.push(message);
  }

  close() {
    this.readyState = WebSocket.CLOSED;
  }
}

function withBrowserWebSocket<T>(fn: () => T): T {
  const location = Object.getOwnPropertyDescriptor(globalThis, "location");
  const webSocket = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  FakeWebSocket.latest = null;
  FakeWebSocket.throwOnConstruct = false;
  FakeWebSocket.throwOnSend = false;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { protocol: "https:", host: "app.example.test" },
  });
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: FakeWebSocket,
  });
  try {
    return fn();
  } finally {
    if (location) Object.defineProperty(globalThis, "location", location);
    else delete (globalThis as { location?: unknown }).location;
    if (webSocket) Object.defineProperty(globalThis, "WebSocket", webSocket);
    else delete (globalThis as { WebSocket?: unknown }).WebSocket;
  }
}

Deno.test("RpcClient connects sends and resolves matching responses", async () => {
  await withBrowserWebSocket(async () => {
    const client = new RpcClient();
    client.connect("/ws");
    const socket = FakeWebSocket.latest;
    assertEquals(socket?.url, "wss://app.example.test/ws");
    socket?.onopen?.();
    assertEquals(client.connected, true);

    const result = client.call<{ ok: boolean }>("health.get");
    const sent = JSON.parse(socket?.sent[0] ?? "{}") as { id?: string };
    socket?.onmessage?.({
      data: JSON.stringify({ id: sent.id, result: { ok: true } }),
    });
    assertEquals(await result, { ok: true });
    client.disconnect();
  });
});

Deno.test("RpcClient connect tolerates unavailable websocket environments", () => {
  const location = Object.getOwnPropertyDescriptor(globalThis, "location");
  const webSocket = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  try {
    delete (globalThis as { location?: unknown }).location;
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: undefined,
    });
    const client = new RpcClient();
    client.connect();
    assertEquals(client.connected, false);
  } finally {
    if (location) Object.defineProperty(globalThis, "location", location);
    if (webSocket) Object.defineProperty(globalThis, "WebSocket", webSocket);
  }
});

Deno.test("RpcClient send and serialization failures do not leave pending calls", async () => {
  await withBrowserWebSocket(async () => {
    const client = new RpcClient();
    client.connect();
    FakeWebSocket.latest?.onopen?.();

    FakeWebSocket.throwOnSend = true;
    try {
      await client.call("health.get");
    } catch (error) {
      assertEquals(error instanceof Error, true);
    }
    assertEquals(
      (client as unknown as { pending: Map<string, unknown> }).pending.size,
      0,
    );

    FakeWebSocket.throwOnSend = false;
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    try {
      await client.call("health.get", [circular]);
    } catch (error) {
      assertEquals(error instanceof Error, true);
    }
    assertEquals(
      (client as unknown as { pending: Map<string, unknown> }).pending.size,
      0,
    );
    client.disconnect();
  });
});
