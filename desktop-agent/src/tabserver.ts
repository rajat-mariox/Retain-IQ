/**
 * Loopback HTTP receiver for the browser extension. The extension POSTs the
 * active tab's URL here whenever it changes (and on a heartbeat), giving the
 * collector the current website even on Windows/Linux where `active-win` can't
 * read a browser's URL. Binds 127.0.0.1 only — never exposed off the machine.
 */
import { createServer, type Server } from "node:http";

export interface TabInfo {
  url: string;
  title: string | null;
  focused: boolean;
  receivedAt: number;
}

let latest: TabInfo | null = null;
let server: Server | null = null;

export function getLatestTab(): TabInfo | null {
  return latest;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function startTabServer(port: number): void {
  if (server) return;
  server = createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    if (req.method === "POST" && req.url === "/tab") {
      let body = "";
      req.on("data", (c) => {
        body += c;
        if (body.length > 8192) req.destroy(); // guard against oversized posts
      });
      req.on("end", () => {
        try {
          const data = JSON.parse(body) as { url?: string; title?: string; focused?: boolean };
          if (typeof data.url === "string" && /^https?:\/\//.test(data.url)) {
            latest = { url: data.url, title: typeof data.title === "string" ? data.title : null, focused: data.focused !== false, receivedAt: Date.now() };
          }
          res.writeHead(204, CORS);
          res.end();
        } catch {
          res.writeHead(400, CORS);
          res.end();
        }
      });
      return;
    }
    res.writeHead(404, CORS);
    res.end();
  });
  server.on("error", () => {
    // Port busy / unavailable — website tracking silently falls back to active-win.
    server = null;
  });
  server.listen(port, "127.0.0.1");
}

export function stopTabServer(): void {
  server?.close();
  server = null;
  latest = null;
}
