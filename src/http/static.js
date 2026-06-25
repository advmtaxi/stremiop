export const INDEX_HTML_CONTENT = "__INDEX_HTML_PLACEHOLDER__";

export function serveStatic(pathname, res) {
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(INDEX_HTML_CONTENT);
    return true;
  }
  return false;
}
