# ローカル確認用（Windowsのレジストリで .js が text/plain になるのを避ける）
import http.server, functools, mimetypes, sys
mimetypes.add_type("text/javascript", ".js"); mimetypes.add_type("application/manifest+json", ".webmanifest")
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=sys.argv[1] if len(sys.argv) > 1 else "docs")
H.func.extensions_map.update({".js": "text/javascript", ".webmanifest": "application/manifest+json"})
http.server.ThreadingHTTPServer(("127.0.0.1", 5173), H).serve_forever()
