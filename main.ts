import('./src/server.ts').catch(console.error);

globalThis.addEventListener('unhandledrejection', e => e.preventDefault());