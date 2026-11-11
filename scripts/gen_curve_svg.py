import math

W, H = 960, 640
ML, MR, MT, MB = 80, 40, 80, 80
CW = W - ML - MR
CH = H - MT - MB

y_min, y_max = 0.5, 20000
def y_pos(v):
    return MT + CH - (math.log10(v) - math.log10(y_min)) / (math.log10(y_max) - math.log10(y_min)) * CH

x_min, x_max = 0.5, 10.5
def x_pos(s):
    return ML + (s - x_min) / (x_max - x_min) * CW

def sm2_points(ef_start=2.5, max_steps=10, fail_at=None):
    pts = []
    interval = 0; repetition = 0; ef = ef_start; day = 0
    for step in range(1, max_steps + 1):
        if repetition == 0: interval = 1
        elif repetition == 1: interval = 3
        elif repetition == 2: interval = 7
        else: interval = round(interval * ef)
        repetition += 1
        ef = max(1.3, ef + 0.1)
        day += interval
        pts.append((x_pos(step), y_pos(interval), interval, ef, 'ok', step))
        if fail_at and step == fail_at:
            interval = 1; repetition = 0; day += interval
            ef_now = max(1.3, ef + 0.1)
            pts.append((x_pos(step + 0.5), y_pos(interval), interval, ef, 'fail', step + 0.5))
    return pts

default_pts = sm2_points(2.5)
easy_pts = sm2_points(3.0)
hard_pts = sm2_points(2.0)
fail_pts = sm2_points(2.5, fail_at=5)

lines = []
lines.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">')
lines.append('  <defs>')
lines.append('    <style>')
lines.append('      text { font-family: "SF Pro Display", -apple-system, "Microsoft YaHei", sans-serif; }')
lines.append('      .title { font-size: 22px; font-weight: 700; fill: #111827; }')
lines.append('      .subtitle { font-size: 13px; fill: #6b7280; }')
lines.append('      .axis-label { font-size: 12px; fill: #374151; font-weight: 600; }')
lines.append('      .axis-tick { font-size: 11px; fill: #6b7280; }')
lines.append('      .legend-text { font-size: 13px; fill: #374151; }')
lines.append('      .point-label { font-size: 11px; fill: #374151; }')
lines.append('    </style>')
lines.append('  </defs>')

lines.append(f'  <rect x="0" y="0" width="{W}" height="{H}" fill="#ffffff"/>')
lines.append(f'  <text x="{W/2}" y="38" text-anchor="middle" class="title">SM-2 记忆曲线 · 间隔增长可视化</text>')
lines.append(f'  <text x="{W/2}" y="58" text-anchor="middle" class="subtitle">连续答对时复习间隔的指数增长 · 对数坐标 Y 轴（单位：天）</text>')

grid_vals = [1, 3, 7, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
for gv in grid_vals:
    y = y_pos(gv)
    if MT <= y <= MT + CH:
        lines.append(f'  <line x1="{ML}" y1="{y:.1f}" x2="{ML+CW}" y2="{y:.1f}" stroke="#f3f4f6" stroke-width="1"/>')
        label = f'{gv}天' if gv < 1000 else f'{gv//1000}k天'
        lines.append(f'  <text x="{ML-10}" y="{y+4:.1f}" text-anchor="end" class="axis-tick">{label}</text>')

for step in range(1, 11):
    x = x_pos(step)
    lines.append(f'  <line x1="{x:.1f}" y1="{MT}" x2="{x:.1f}" y2="{MT+CH}" stroke="#f3f4f6" stroke-width="1"/>')
    lines.append(f'  <text x="{x:.1f}" y="{MT+CH+22}" text-anchor="middle" class="axis-tick">{step}</text>')

lines.append(f'  <line x1="{ML}" y1="{MT}" x2="{ML}" y2="{MT+CH}" stroke="#d1d5db" stroke-width="1.5"/>')
lines.append(f'  <line x1="{ML}" y1="{MT+CH}" x2="{ML+CW}" y2="{MT+CH}" stroke="#d1d5db" stroke-width="1.5"/>')

label_y = MT + CH / 2
lines.append(f'  <text x="{ML-55}" y="{label_y}" text-anchor="middle" class="axis-label" transform="rotate(-90 {ML-55} {label_y})">复习间隔（天，对数）</text>')
lines.append(f'  <text x="{ML+CW/2}" y="{MT+CH+50}" text-anchor="middle" class="axis-label">连续答对次数</text>')

def draw_curve(pts, color, dashes=None):
    ok_pts = [p for p in pts if p[4] == 'ok']
    d = ' '.join(f'M {p[0]:.1f} {p[1]:.1f}' if i == 0 else f'L {p[0]:.1f} {p[1]:.1f}' for i, p in enumerate(ok_pts))
    dash_attr = f' stroke-dasharray="{dashes}"' if dashes else ''
    lines.append(f'  <path d="{d}" fill="none" stroke="{color}" stroke-width="2.5"{dash_attr} stroke-linecap="round" stroke-linejoin="round"/>')
    for p in ok_pts:
        lines.append(f'  <circle cx="{p[0]:.1f}" cy="{p[1]:.1f}" r="4.5" fill="{color}" stroke="#ffffff" stroke-width="2"/>')

draw_curve(default_pts, '#2563eb')
draw_curve(easy_pts, '#16a34a', '6,3')
draw_curve(hard_pts, '#dc2626', '3,3')

fail_path = ' '.join(f'M {p[0]:.1f} {p[1]:.1f}' if i == 0 else f'L {p[0]:.1f} {p[1]:.1f}' for i, p in enumerate(fail_pts))
lines.append(f'  <path d="{fail_path}" fill="none" stroke="#9333ea" stroke-width="2.5" stroke-dasharray="2,2" stroke-linecap="round"/>')
for p in fail_pts:
    if p[4] == 'fail':
        lines.append(f'  <circle cx="{p[0]:.1f}" cy="{p[1]:.1f}" r="8" fill="none" stroke="#dc2626" stroke-width="2.5"/>')
        lines.append(f'  <text x="{p[0]+14:.1f}" y="{p[1]-10:.1f}" class="point-label" fill="#dc2626" font-weight="600">答错→重置为1天</text>')

legend_x = ML + CW - 200
legend_y = MT + 10
lines.append(f'  <rect x="{legend_x-10}" y="{legend_y-10}" width="220" height="145" rx="8" fill="#f9fafb" stroke="#e5e7eb"/>')
legend_items = [
    ('#2563eb', '默认 (ef=2.5,每次+0.1)', None),
    ('#16a34a', '简单词 (ef=3.0)', '6,3'),
    ('#dc2626', '难词 (ef=2.0)', '3,3'),
    ('#9333ea', '第5步答错后重置', '2,2'),
]
for i, (color, text, dash) in enumerate(legend_items):
    ly = legend_y + i * 32 + 14
    da = f' stroke-dasharray="{dash}"' if dash else ''
    lines.append(f'  <line x1="{legend_x}" y1="{ly}" x2="{legend_x+30}" y2="{ly}" stroke="{color}" stroke-width="2.5"{da}/>')
    lines.append(f'  <text x="{legend_x+40}" y="{ly+4}" class="legend-text">{text}</text>')

note_y = MT + CH + 58
lines.append(f'  <text x="{ML}" y="{note_y}" class="subtitle">SM-2 三阶段递增：rep=0→1天 | rep=1→3天 | rep=2→7天 | rep≥3→interval × ef</text>')
lines.append(f'  <text x="{ML}" y="{note_y+18}" class="subtitle">答错/模糊 → repetition 清零 + interval 重置为 1 天 + ef 不惩罚</text>')
lines.append(f'  <text x="{ML}" y="{note_y+36}" class="subtitle">斩（降级）→ 跳过记忆曲线，直接设为 180 天后再复习</text>')

lines.append('</svg>')

with open('e:/Codes/word_recite/记忆曲线.svg', 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))
print('✅ SVG generated')
