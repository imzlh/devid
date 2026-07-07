/**
 * 极简代理服务器实现
 * 直接拷贝到Deno Deploy即可使用
 */
// deno-lint-ignore no-import-prefix no-unversioned-import -- Keep this file copy-pasteable for Deno Deploy.
import { decodeBase64 } from "jsr:@std/encoding";

const headers = new Headers({
    "Server": "nginx"
})

async function handle(req: Request) {
    const dest = req.headers.get('X-Proxy-Destination');
    if (!dest) return new Response('Forbidden', { status: 403, headers });
    let url;
    try {
        url = new URL(new TextDecoder().decode(decodeBase64(dest)));
    } catch {
        return new Response('Bad Request', { status: 400, headers });
    }
    const header = new Headers(req.headers);
    header.delete('X-Proxy-Destination');
    header.delete('Host');

    // build new request
    const request = new Request(url, {
        method: req.method,
        headers: header,
        body: req.body,
        redirect: 'manual'
    });
    try{
        return await fetch(request);
    } catch (e) {
        return new Response("Gateway Error: " + (e as Error).message, { status: 502, headers });
    }
}

const authPath = Deno.env.get('PROXY_PATH') ?? '/';
const middlewares: Array<(req: Request, next: () => Promise<Response>) => Response | Promise<Response>> = [
    // auth middleware
    (req, next) => {
        if (new URL(req.url).pathname === authPath) {
            return next();
        } else {
            return new Response('Not Found', { status: 404, headers });
        }
    },

    // option middleware
    (req, next) => {
        if (req.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: {
                    'Allow': 'GET, POST, OPTIONS',
                    'Server': 'nginx'
                }
            });
        } else {
            return next();
        }
    }
];

Deno.serve(req => {
    // wrap all function
    let next: () => Promise<Response> = () => handle(req);
    for (let i = middlewares.length - 1; i >= 0; i--) {
        const mw = middlewares[i];
        const _next = next;
        next = () => Promise.resolve(mw(req, _next));
    }

    // execute all function
    return next();
});
