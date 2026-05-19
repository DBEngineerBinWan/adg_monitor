"""Webhook 测试接收器 — 监听 POST 请求并打印告警内容"""
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import sys

class WebhookHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write('''<html><head><meta charset="utf-8"><title>Webhook 测试接收器</title>
<style>body{font-family:monospace;padding:40px;background:#0a0e27;color:#e5e7eb}
h2{color:#00d4ff}.card{background:#1a2040;border:1px solid rgba(0,212,255,.2);padding:20px;border-radius:8px;margin:10px 0}
#log{background:#111;padding:10px;max-height:400px;overflow-y:auto;border-radius:6px;font-size:12px;margin-top:10px}
.alert{color:#ef4444}.ok{color:#22c55e}</style></head>
<body><h2>🔔 Webhook 测试接收器</h2>
<div class="card"><span class="ok">● 运行中</span> &nbsp; POST → <code>http://localhost:9999/webhook</code>
<p>收到的告警会实时显示在下方。</p></div>
<div id="log">等待接收告警...</div>
</body></html>'''.encode('utf-8'))

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length).decode('utf-8')
        # 先响应，再打印（避免客户端超时断开）
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"ok":true}')
        sys.stdout.flush()
        print(f"\n{'='*60}")
        print(f"[WEBHOOK] {self.path}")
        try:
            data = json.loads(body)
            print(f"Payload: {json.dumps(data, indent=2, ensure_ascii=False)}")
            print(f"\n  ⚡ {data.get('db_name')}: {data.get('old_status')} → {data.get('new_status')}")
            print(f"  Lag: {data.get('apply_lag_seconds')}s | MRP: {data.get('mrp_status')}")
        except Exception:
            print(f"Body: {body}")
        print(f"{'='*60}\n")
        sys.stdout.flush()

    def log_message(self, format, *args):
        pass  # 静默日志

print("🔔 Webhook 测试接收器启动 → http://localhost:9999/webhook")
print("   复制这个 URL 到告警推送配置中，然后触发采集即可测试\n")
HTTPServer(('', 9999), WebhookHandler).serve_forever()
