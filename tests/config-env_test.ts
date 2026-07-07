import { assertEquals } from "@std/assert";
import {
  loadConfigFromEnv,
  normalizeConfigInput,
} from "../src/config/index.ts";

function env(
  values: Record<string, string>,
): (name: string) => string | undefined {
  return (name) => values[name];
}

Deno.test("loadConfigFromEnv reads proxy gateway settings", () => {
  const config = loadConfigFromEnv(env({
    DV_PROXY_GATEWAY: "http://127.0.0.1:7890/proxy",
    DV_PROXY_TIMEOUT: "12000",
    DV_PROXY_MAX_RETRIES: "5",
  }));

  assertEquals(config.proxy?.gateway, "http://127.0.0.1:7890/proxy");
  assertEquals(config.proxy?.timeoutMs, 12000);
  assertEquals(config.proxy?.maxRetries, 5);
});

Deno.test("loadConfigFromEnv keeps unrelated sections mergeable", () => {
  const config = loadConfigFromEnv(env({
    DV_SERVER_PORT: "9999",
    DV_DOWNLOAD_OUTPUT: "./videos",
  }));

  assertEquals(config.server?.port, 9999);
  assertEquals(config.download?.defaultOutputPath, "./videos");
  assertEquals(config.proxy, undefined);
});

Deno.test("loadConfigFromEnv ignores malformed integer values", () => {
  const config = loadConfigFromEnv(env({
    DV_SERVER_PORT: "9876oops",
    DV_PROXY_TIMEOUT: "-1",
    DV_DOWNLOAD_CONCURRENT: "0",
    DV_PROXY_GATEWAY: "  http://127.0.0.1:7890/proxy  ",
  }));

  assertEquals(config.server, undefined);
  assertEquals(config.download, undefined);
  assertEquals(config.proxy?.timeoutMs, undefined);
  assertEquals(config.proxy?.gateway, "http://127.0.0.1:7890/proxy");
});

Deno.test("normalizeConfigInput keeps only known valid config fields", () => {
  const config = normalizeConfigInput({
    server: {
      port: "9988",
      verboseLogging: "true",
      dataDir: " ./state ",
      extra: "ignored",
    },
    videoSource: {
      initTimeoutMs: 5000,
      initRetryAttempts: 0,
      initRetryDelayMs: "0",
    },
    download: {
      timeoutMs: "bad",
      maxConcurrent: "4",
      minDiskFreeMB: -1,
      retryAttempts: 3,
      defaultOutputPath: " ./videos ",
    },
    proxy: {
      timeoutMs: 12000,
      maxRetries: "2",
      gateway: "",
    },
    unknown: { value: true },
  });

  assertEquals(config, {
    server: {
      port: 9988,
      dataDir: "./state",
    },
    videoSource: {
      initTimeoutMs: 5000,
      initRetryDelayMs: 0,
    },
    download: {
      maxConcurrent: 4,
      retryAttempts: 3,
      defaultOutputPath: "./videos",
    },
    proxy: {
      timeoutMs: 12000,
      maxRetries: 2,
    },
  });
});

Deno.test("normalizeConfigInput ignores malformed config sections", () => {
  assertEquals(
    normalizeConfigInput({
      server: [],
      videoSource: null,
      download: "bad",
      proxy: {
        timeoutMs: 0,
        maxRetries: -1,
        gateway: 123,
      },
    }),
    {},
  );
});
