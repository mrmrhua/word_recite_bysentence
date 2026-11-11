# 多线程 HTTP 服务器（比 python -m http.server 快 5-10 倍）
# 支持并发请求，手机访问也快
# 用法：.\serve.ps1

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8080

# 杀掉旧进程
Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

# 用 Python 的 http.server + ThreadingHTTPServer
$script = @'
import http.server, socketserver, os, sys, mimetypes

os.chdir(sys.argv[1])

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # 添加缓存控制（js/css 缓存 1 小时，html 不缓存）
        path = self.path.split('?')[0]
        if path.endswith(('.js', '.css', '.png', '.svg', '.ico')):
            self.send_header('Cache-Control', 'public, max-age=3600')
        elif path.endswith('.html') or path == '/':
            self.send_header('Cache-Control', 'no-cache')
        return super().do_GET()

class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

with ThreadingServer(('0.0.0.0', int(sys.argv[2])), Handler) as httpd:
    print(f"✅ Serving {sys.argv[1]} on http://0.0.0.0:{sys.argv[2]}")
    httpd.serve_forever()
'@

$tmp = Join-Path $env:TEMP "serve_multithread.py"
Set-Content -Path $tmp -Value $script -Encoding UTF8
python $tmp $root $port
