import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname } from "node:path";

const root = new URL("../../", import.meta.url);
const scope = "/cadence/";
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
};

async function serve(request, response) {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  if (path === "/favicon.ico") {
    response.writeHead(204).end();
    return;
  }
  const file = path.slice(scope.length) || "index.html";
  const type = contentTypes[extname(file)];
  if (!path.startsWith(scope) || !type) {
    response.writeHead(404).end();
    return;
  }

  try {
    const bytes = await readFile(new URL(file, root));
    response.writeHead(200, { "Content-Type": type }).end(bytes);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500).end();
  }
}

export async function startSite() {
  const server = createServer(serve);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  let closing;

  return {
    url: `http://127.0.0.1:${server.address().port}${scope}`,
    close() {
      if (!closing) {
        closing = new Promise((resolve) => server.close(resolve));
        server.closeAllConnections();
      }
      return closing;
    },
  };
}
