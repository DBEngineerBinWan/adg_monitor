"""Webhook 测试接收器 — 监听 POST 请求并实时显示告警内容"""
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import sys
from datetime import datetime

alerts = []  # 内存存储已收到的告警
MAX_ALERTS = 50

class WebhookHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        alerts_html = ''
        for a in reversed(alerts):
            color = {'green': '#22c55e', 'yellow': '#eab308', 'red': '#ef4444'}.get(a.get('new_status', ''), '#9ca3af')
            alerts_html += f'''<div style="background:#1a2040;border-left:3px solid {color};padding:10px 14px;margin:6px 0;border-radius:0 6px 6px 0;font-size:13px">
  <span style="color:{color}">●</span> <b>{a['db_name']}</b>
  <span style="color:#9ca3af"> {a.get('old_status','?')} → {a.get('new_status','?')}</span>
  <span style="color:#6b7280;float:right">{a.get('time','')}</span><br>
  <span style="color:#6b7280;font-size:11px">Lag: {a.get('apply_lag_seconds',0)}s | MRP: {a.get('mrp_status','?')}</span>
</div>'''

        html = f'''<html><head><meta charset="utf-8"><title>Webhook 测试接收器</title>
<meta http-equiv="refresh" content="3">
<style>body{{font-family:monospace;padding:24px;background:#0a0e27;color:#e5e7eb;max-width:800px;margin:0 auto}}
h2{{color:#00d4ff}}.card{{background:#1a2040;border:1px solid rgba(0,212,255,.2);padding:16px;border-radius:8px;margin:10px 0}}
.ok{{color:#22c55e}}.count{{color:#9ca3af;font-size:12px}}</style></head>
<body><h2>🔔 Webhook 测试接收器</h2>
<div class="card"><span class="ok">● 运行中</span> &nbsp; POST → <code>http://127.0.0.1:9999/webhook</code>
<p class="count">已收到 <b>{len(alerts)}</b> 条告警 · 每3秒自动刷新</p></div>
<div>{alerts_html if alerts_html else '<p style="color:#6b7280;text-align:center;padding:40px">等待接收告警...点击"测试推送"按钮</p>'}</div>
</body></html>'''
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(html.encode('utf-8'))

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length).decode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"ok":true}')
        try:
            data = json.loads(body)
            data['time'] = datetime.now().strftime('%H:%M:%S')
            alerts.append(data)
            if len(alerts) > MAX_ALERTS:
                alerts.pop(0)
            print(f"[WEBHOOK] {data.get('db_name')}: {data.get('old_status')} → {data.get('new_status')} | Lag={data.get('apply_lag_seconds')}s")
            sys.stdout.flush()
        except Exception as e:
            print(f"[WEBHOOK] 解析失败: {e}")
            sys.stdout.flush()

    def log_message(self, format, *args):
        pass

print("🔔 Webhook 测试接收器启动 → http://127.0.0.1:9999/webhook")
print("   浏览器打开此地址，页面每3秒自动刷新显示新告警\n")
HTTPServer(('', 9999), WebhookHandler).serve_forever()
