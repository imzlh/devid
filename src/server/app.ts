import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import type { ServerContext } from "./context.ts";
import { registerApiRoutes } from "./api-routes.ts";
import { registerProxyRoutes } from "./proxy-routes.ts";
import { registerRpcHandlers } from "./rpc-routes.ts";
import { logDebug } from "../utils/logger.ts";

const WEB_DIST = "./web/dist";
const WEB_INDEX = `${WEB_DIST}/index.html`;

export function createApp(ctx: ServerContext): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    c.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Range",
    );
    c.header(
      "Access-Control-Expose-Headers",
      "Content-Range, Content-Length, Accept-Ranges",
    );
    await next();
  });

  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    logDebug(`${c.req.method} ${c.req.url} - ${c.res.status} - ${ms}ms`);
  });

  registerApiRoutes(app, ctx);
  registerProxyRoutes(app, ctx);
  registerRpcHandlers(ctx);

  app.get("/", serveStatic({ path: WEB_INDEX }));
  app.use("/*", serveStatic({ root: WEB_DIST }));
  app.use("*", async (c, next) => {
    const path = c.req.path;
    if (path.startsWith("/api/") || path.startsWith("/ws")) {
      await next();
      return;
    }

    try {
      const html = await Deno.readTextFile(WEB_INDEX);
      return c.html(html);
    } catch {
      return c.text("web/dist not found. Run: cd web && pnpm build", 503);
    }
  });

  return app;
}
