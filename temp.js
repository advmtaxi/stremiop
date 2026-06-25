// src/server.js
var import_node_http = require("node:http");

// src/env.js
var port = Number(process.env.PORT) || 7860;
var streamedOrigin = process.env.STREAMED_ORIGIN || "https://streamed.pk";
var embedOrigin = process.env.EMBED_ORIGIN || "https://embed.st";
var ua = process.env.USER_AGENT || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

// src/wire/curl.js
var import_child_process = require("child_process");
var import_util = require("util");
var execFileAsync = (0, import_util.promisify)(import_child_process.execFile);
function hdrs(slot2) {
  return {
    Referer: `${slot2.origin}/`,
    Origin: slot2.origin,
    "User-Agent": ua,
    Accept: "*/*"
  };
}
async function pull(url, slot2) {
  const headers = hdrs(slot2);
  const args = ["-s", "-f", "-L"];
  for (const [k, v] of Object.entries(headers)) {
    args.push("-H", `${k}: ${v}`);
  }
  args.push(url);
  try {
    const { stdout } = await execFileAsync("curl", args, { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    throw new Error(`upstream failed: ${err.message || "unknown"}`);
  }
}

// src/streamed/api.js
async function fetchJson(path) {
  const res = await fetch(`${streamedOrigin}${path}`, {
    headers: { "User-Agent": ua, Accept: "application/json" }
  });
  if (!res.ok) throw new Error(`streamed.pk ${path} ${res.status}`);
  return res.json();
}

// src/streamed/match.js
async function fetchLinks(source, id) {
  const links = await fetchJson(`/api/stream/${encodeURIComponent(source)}/${encodeURIComponent(id)}`);
  if (!Array.isArray(links) || links.length === 0) throw new Error("no streams returned for source");
  return links;
}
function pickLink(links, streamNo) {
  if (streamNo == null || streamNo === "") throw new Error("stream number required");
  const wanted = Number(streamNo);
  const picked = links.find((link) => Number(link.streamNo) === wanted);
  if (!picked) throw new Error(`stream ${streamNo} not found`);
  return picked;
}

// src/streamed/watch.js
var watchRe = /^\/watch\/([^/]+)\/([^/]+)\/(\d+)\/?$/;
async function loadMatch(matchId) {
  const list = await fetchJson("/api/matches/all");
  if (!Array.isArray(list)) throw new Error("streamed.pk /api/matches/all invalid response");
  const match = list.find((item) => item.id === matchId);
  if (!match) throw new Error(`match not found: ${matchId}`);
  return match;
}
function pickSource(match, name) {
  const sources = match.sources ?? [];
  if (!sources.length) throw new Error("match has no stream sources");
  const picked = sources.find((item) => item.source === name);
  if (!picked) throw new Error(`source ${name} not found`);
  return picked;
}
function watchLink(matchId, source, stream) {
  return `${streamedOrigin}/watch/${matchId}/${source}/${Number(stream)}`;
}
function parseWatchPath(pathname) {
  const m = pathname.match(watchRe);
  if (!m) return null;
  return { matchId: m[1], source: m[2], stream: m[3] };
}
async function loadWatch(matchId, source, stream) {
  const match = await loadMatch(matchId);
  const src = pickSource(match, source);
  const link = pickLink(await fetchLinks(src.source, src.id), stream);
  return {
    matchId: match.id,
    title: match.title,
    watchUrl: watchLink(match.id, link.source, link.streamNo),
    embedUrl: link.embedUrl,
    slot: {
      origin: embedOrigin,
      path: `${link.source}/${link.id}/${link.streamNo}`,
      source: link.source,
      id: link.id,
      stream: String(link.streamNo),
      slug: link.id
    }
  };
}

// src/goat/parse.js
var embedRe = /^\/embed\/([^/]+)\/([^/]+)\/(\d+)\/?$/;
var streamRe = /^\/api\/stream\/([^/]+)\/([^/]+)\/?$/;
function slot(origin, source, id, stream) {
  return { origin, path: `${source}/${id}/${stream}`, source, id, stream, slug: id };
}
function parseUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) throw new Error("url required");
  try {
    return new URL(s);
  } catch {
    throw new Error("invalid url");
  }
}
function isStreamed(host) {
  return host === "streamed.pk" || host.endsWith(".streamed.pk");
}
function isEmbed(host) {
  return host.includes("embed.");
}
async function fromApi(source, id, streamNo) {
  if (streamNo == null || streamNo === "") throw new Error("stream number required");
  const link = pickLink(await fetchLinks(source, id), streamNo);
  return slot(embedOrigin, link.source, link.id, String(link.streamNo));
}
async function parseInput(raw) {
  const url = parseUrl(raw);
  const watch = parseWatchPath(url.pathname);
  if (watch && isStreamed(url.hostname)) return (await loadWatch(watch.matchId, watch.source, watch.stream)).slot;
  const em = url.pathname.match(embedRe);
  if (em && isEmbed(url.hostname)) return slot(url.origin, em[1], em[2], em[3]);
  const api = url.pathname.match(streamRe);
  if (api && isStreamed(url.hostname)) return fromApi(api[1], api[2], url.searchParams.get("stream"));
  throw new Error("expected /watch/{id}/{source}/{n} or embed.st /embed/{source}/{id}/{n}");
}
function relayLink(base, target, slot2) {
  const q = new URLSearchParams({ url: target, embed: slot2.path, embedOrigin: slot2.origin });
  return `${base}/api/hls?${q}`;
}

// src/relay/segment.js
function tsOff(buf) {
  for (let i = 0; i < Math.min(buf.length, 65536); i++) {
    if (buf[i] === 71 && i + 188 < buf.length && buf[i + 188] === 71) return i;
  }
  return -1;
}
function strip(buf) {
  if (buf.length < 4 || buf[0] === 71) return buf;
  if (buf[0] === 137 && buf[1] === 80 && buf[2] === 78 && buf[3] === 71) {
    const iend = buf.indexOf(Buffer.from("IEND"));
    if (iend >= 0 && iend + 8 < buf.length) return buf.subarray(iend + 8);
  }
  const at = tsOff(buf);
  if (at >= 0) return buf.subarray(at);
  return buf;
}
function segmentBody(body) {
  const out = strip(body);
  if (out.length >= 188 && out[0] === 71) return out;
  throw new Error("invalid segment payload");
}

// src/relay/m3u8.js
var cors = { "Access-Control-Allow-Origin": "*" };
function parseSlot(params) {
  const path = params.get("embed");
  const origin = params.get("embedOrigin");
  if (!path || !origin) throw new Error("embed and embedOrigin required");
  const parts = path.split("/");
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error("invalid embed path");
  return { origin, path };
}
function absUri(uri, base) {
  return uri.startsWith("http") ? uri : new URL(uri, base).href;
}
function isPlaylist(body) {
  const head = body.toString("utf8", 0, Math.min(body.length, 256));
  return head.includes("#EXTM3U");
}
function rewrite(text, base, slot2, origin) {
  return text.split("\n").map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith("#")) {
      if (!t.includes('URI="')) return line;
      return t.replace(/URI="([^"]+)"/g, (_, uri) => {
        const href2 = absUri(uri, base);
        if (href2.includes(".m3u8")) return `URI="${relayLink(origin, href2, slot2)}"`;
        return `URI="${href2}"`;
      });
    }
    const href = absUri(t, base);
    if (href.includes(".m3u8")) return relayLink(origin, href, slot2);
    return href;
  }).join("\n");
}
async function relay(res, url, slot2, origin) {
  const raw = await pull(url, slot2);
  if (isPlaylist(raw)) {
    res.writeHead(200, {
      ...cors,
      "Content-Type": "application/vnd.apple.mpegurl",
      "Cache-Control": "no-cache"
    });
    res.end(rewrite(raw.toString("utf8"), url, slot2, origin));
    return;
  }
  res.writeHead(200, { ...cors, "Content-Type": "video/mp2t", "Cache-Control": "no-cache" });
  res.end(segmentBody(raw));
}
async function serve(res, params, origin) {
  const target = params.get("url");
  if (!target) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("url required");
    return;
  }
  let slot2;
  try {
    slot2 = parseSlot(params);
  } catch (err) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end(String(err.message || err));
    return;
  }
  try {
    await relay(res, target, slot2, origin);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end(String(err.message || err));
    }
  }
}

// src/wire/embed.js
async function postFetch(body, slot2, clientIp) {
  const referer = `${slot2.origin}/embed/${slot2.path}`;
  const headers = {
    "Content-Type": "application/octet-stream",
    Origin: slot2.origin,
    Referer: referer,
    "User-Agent": ua
  };
  const res = await fetch(`${slot2.origin}/fetch`, {
    method: "POST",
    headers,
    body
  });
  if (!res.ok) {
    const detail = (await res.text()).trim() || res.statusText;
    throw new Error(`embed /fetch ${res.status}: ${detail}`);
  }
  const goat = res.headers.get("goat");
  if (!goat) throw new Error("missing goat header");
  return { body: Buffer.from(await res.arrayBuffer()), goat };
}

// src/goat/proto.js
function varint(n) {
  const bytes = [];
  let v = n;
  while (v > 127) {
    bytes.push(v & 127 | 128);
    v >>>= 7;
  }
  bytes.push(v);
  return Buffer.from(bytes);
}
function fieldStr(out, field, value) {
  const body = Buffer.from(String(value), "utf8");
  out.push(Buffer.from([field << 3 | 2]));
  out.push(varint(body.length));
  out.push(body);
}
function encodeBody({ source, id, stream }) {
  const out = [];
  fieldStr(out, 1, source);
  fieldStr(out, 2, id);
  fieldStr(out, 3, stream);
  return Buffer.concat(out);
}

// src/goat/lock.js
var import_node_worker_threads = require("node:worker_threads");
var import_node_url = require("node:url");
var import_node_path = require("node:path");
var import_meta = {};
var workerUrl = (0, import_node_path.join)((0, import_node_path.dirname)((0, import_node_url.fileURLToPath)(import_meta.url)), "lock-worker.js");
function unlock(slot2, goat, body) {
  return new Promise((resolve, reject) => {
    const worker = new import_node_worker_threads.Worker(workerUrl, {
      workerData: { slot: slot2, goat, bodyHex: body.toString("hex") }
    });
    worker.once("message", (msg) => {
      worker.terminate().catch(() => {
      });
      if (msg.ok) resolve(msg.url);
      else reject(new Error(msg.error || "lock decrypt failed"));
    });
    worker.once("error", (err) => {
      worker.terminate().catch(() => {
      });
      reject(err);
    });
  });
}

// src/goat/run.js
async function run(input, origin, clientIp) {
  let slot2;
  let meta;
  try {
    if (input?.matchId) {
      if (!input.source || input.stream == null) {
        return { ok: false, stage: "input", error: "matchId requires source and stream" };
      }
      meta = await loadWatch(input.matchId, input.source, String(input.stream));
      slot2 = meta.slot;
    } else if (input?.url?.trim()) {
      slot2 = await parseInput(input.url.trim());
    } else {
      return { ok: false, stage: "input", error: "url or matchId required" };
    }
  } catch (err) {
    return { ok: false, stage: "input", error: String(err.message || err) };
  }
  try {
    const { body, goat } = await postFetch(encodeBody(slot2), slot2, clientIp);
    const m3u8 = await unlock(slot2, goat, body);
    return {
      ok: true,
      slug: slot2.slug,
      source: slot2.source,
      stream: slot2.stream,
      matchId: meta?.matchId,
      title: meta?.title,
      watchUrl: meta?.watchUrl,
      embedUrl: meta?.embedUrl,
      m3u8,
      relay: relayLink(origin, m3u8, slot2)
    };
  } catch (err) {
    return { ok: false, stage: "resolve", error: String(err.message || err) };
  }
}

// src/http/static.js
var import_node_fs = require("node:fs");
var import_node_path2 = require("node:path");
var import_node_url2 = require("node:url");
var import_meta2 = {};
var root = (0, import_node_path2.join)((0, import_node_path2.dirname)((0, import_node_url2.fileURLToPath)(import_meta2.url)), "../../public");
var assets = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/player.js": ["player.js", "application/javascript; charset=utf-8"]
};
function serveStatic(pathname, res) {
  const asset = assets[pathname];
  if (!asset) return false;
  res.writeHead(200, { "Content-Type": asset[1], "Cache-Control": "no-store" });
  (0, import_node_fs.createReadStream)((0, import_node_path2.join)(root, asset[0])).pipe(res);
  return true;
}

// src/http/router.js
function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  });
  res.end(JSON.stringify(body));
}
async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}
function stripPrefix(id) {
  return id.startsWith("spk:") ? id.slice(4) : id;
}
async function route(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    });
    res.end();
    return;
  }
  if (!req.headers.host) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("missing host");
    return;
  }
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const loc = new URL(req.url ?? "/", `${proto}://${host}`);
  const { searchParams, origin } = loc;
  const pathname = decodeURIComponent(loc.pathname);
  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;
  try {
    if (pathname === "/manifest.json") {
      return json(res, 200, {
        id: "org.streamedpk.addon",
        version: "1.0.0",
        name: "Streamed.pk Sports",
        description: "Live Sports Streams from streamed.pk, natively resolved!",
        catalogs: [{ type: "tv", id: "streamedpk", name: "Live Sports" }],
        resources: ["catalog", "meta", "stream"],
        types: ["tv", "sport"],
        idPrefixes: ["spk:"]
      });
    }
    if (pathname.startsWith("/catalog/tv/streamedpk")) {
      const list = await fetchJson("/api/matches/all");
      const metas = list.map((match) => ({
        id: `spk:${match.id}`,
        type: "tv",
        name: match.title,
        poster: match.poster ? `${streamedOrigin}${match.poster}` : void 0,
        description: `${match.category ? match.category.toUpperCase() : ""} - ${new Date(match.date).toLocaleString()}`
      }));
      return json(res, 200, { metas });
    }
    if (pathname.startsWith("/meta/tv/spk:")) {
      const matchId = stripPrefix(pathname.split("/")[3].replace(".json", ""));
      const list = await fetchJson("/api/matches/all");
      const match = list.find((item) => item.id === matchId);
      if (!match) return json(res, 404, { meta: null });
      return json(res, 200, {
        meta: {
          id: `spk:${match.id}`,
          type: "tv",
          name: match.title,
          poster: match.poster ? `${streamedOrigin}${match.poster}` : void 0,
          description: `Live sports event: ${match.title}`,
          background: match.poster ? `${streamedOrigin}${match.poster}` : void 0
        }
      });
    }
    if (pathname.startsWith("/stream/tv/spk:")) {
      const matchId = stripPrefix(pathname.split("/")[3].replace(".json", ""));
      const list = await fetchJson("/api/matches/all");
      const match = list.find((item) => item.id === matchId);
      if (!match || !match.sources || match.sources.length === 0) {
        return json(res, 200, { streams: [] });
      }
      const streams = [];
      for (const source of match.sources) {
        try {
          const links = await fetchLinks(source.source, source.id);
          for (const link of links) {
            try {
              const body = { matchId: match.id, source: source.source, stream: link.streamNo };
              const result = await run(body, origin, clientIp);
              if (result.ok && result.m3u8) {
                const quality = link.hd ? "HD" : "SD";
                const lang = link.language ? link.language.toUpperCase() : "EN";
                const viewers = link.viewers ? `${link.viewers} viewers` : "";
                streams.push({
                  name: `Streamed.pk
${source.source.toUpperCase()}`,
                  title: `Stream ${link.streamNo} | ${quality} | ${lang}
${viewers}`,
                  url: result.relay
                });
              }
            } catch (e) {
              console.error(`Failed resolving stream ${link.streamNo} for ${source.source}:`, e);
            }
          }
        } catch (e) {
          console.error(`Failed fetching links for ${source.source}:`, e);
        }
      }
      return json(res, 200, { streams });
    }
    if (pathname === "/api/hls") {
      await serve(res, searchParams, origin);
      return;
    }
    if (pathname === "/api/stream") {
      if (req.method !== "POST") {
        json(res, 405, { error: "POST required" });
        return;
      }
      let body;
      try {
        body = await readJson(req);
      } catch {
        json(res, 400, { ok: false, error: "invalid json" });
        return;
      }
      json(res, 200, await run(body, origin, clientIp));
      return;
    }
    if (serveStatic(pathname, res)) return;
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  } catch (err) {
    json(res, 500, { ok: false, error: String(err.message || err) });
  }
}

// src/server.js
var srv = (0, import_node_http.createServer)(route);
function boot() {
  const addr = srv.address();
  const host = typeof addr === "string" ? addr : `localhost:${addr.port}`;
  console.log(`http://${host}/`);
}
var hostBinding = process.env.HOST || "0.0.0.0";
srv.listen(port, hostBinding, boot);
