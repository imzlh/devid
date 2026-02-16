import { Buffer } from "node:buffer";

export async function getReadme(owner: string, repo: string, token?: string) {
    const headers: Record<string, string> = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "@devid/ghapi"
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/readme`,
        { headers }
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    // 解码 Base64
    const content = Buffer.from(data.content, "base64").toString("utf8");

    return {
        content,
        htmlUrl: data.html_url,
        downloadUrl: data.download_url,
        sha: data.sha
    };
}