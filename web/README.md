# VDown Web

Vue 3 + TypeScript + Vite 前端。生产环境由 Hono 直接服务 `web/dist`。

```bash
pnpm dev
pnpm build
```

开发模式会把 `/api` 和 `/ws` 代理到 `http://localhost:9876`。
