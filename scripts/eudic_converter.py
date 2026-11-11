"""
eudic_converter.py — 欧陆词典 CSV → 背单词系统 Excel 模板

用法：
    python eudic_converter.py <input.csv> [-o output.xlsx] [-b batch_size]

也可以在代码里直接调用：
    from eudic_converter import convert_csv_to_template
    convert_csv_to_template("input.csv", "output.xlsx", batch_size=10)

DeepSeek API 使用环境变量 ds_key，base_url=https://api.deepseek.com
"""

import csv
import json
import os
import re
import sys
import time
import argparse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment


API_URL = "https://api.deepseek.com/chat/completions"
MODEL = "deepseek-flash"
MAX_WORKERS = 4  # 并发线程数（flash QPS=10，4 个足够）


# ========== CSV 解析 ==========

def parse_eudic_csv(csv_path: str) -> list[dict]:
    """
    解析欧陆词典导出 CSV。
    列可能是：index, 单词, 音标, 解释, 笔记（第一列可能是行号）
    返回: [{"word": str, "phonetic": str, "meaning": str, "note": str}, ...]
    """
    rows = []
    # 尝试多种编码
    for encoding in ("utf-8-sig", "utf-8", "gbk", "gb18030"):
        try:
            with open(csv_path, "r", encoding=encoding) as f:
                reader = csv.reader(f)
                header = next(reader, None)
                # 找列的索引
                word_idx = phon_idx = mean_idx = note_idx = None
                for i, h in enumerate(header or []):
                    h = (h or "").strip()
                    if h in ("单词", "word", "Word"):
                        word_idx = i
                    elif h in ("音标", "phonetic", "音标/读音"):
                        phon_idx = i
                    elif h in ("解释", "释义", "中文释义", "meaning"):
                        mean_idx = i
                    elif h in ("笔记", "备注", "note"):
                        note_idx = i

                # 如果 header 全是空或者第一列是数字，说明没有 header
                if word_idx is None and header:
                    # 尝试推断：index, word, phonetic, meaning, note
                    non_empty = [c for c in header if c and c.strip()]
                    if not non_empty or (header[0] and header[0].strip().isdigit()):
                        # 把 header 当作第一行数据
                        rows.append(_parse_row(header))
                        header = None

                if word_idx is not None or header is None:
                    for row in reader:
                        if not row or all(not c.strip() for c in row):
                            continue
                        rows.append(_parse_row(row, word_idx, phon_idx, mean_idx, note_idx))
                break
        except UnicodeDecodeError:
            continue

    return rows


def _parse_row(row, word_idx=None, phon_idx=None, mean_idx=None, note_idx=None) -> dict:
    """从一行 CSV 里抽取单词/音标/释义/备注"""
    # 没有 header 索引的话按默认位置推断：index, word, phonetic, meaning, note
    if word_idx is None:
        # 跳过可能的行号
        start = 1 if row and row[0].strip().isdigit() else 0
        return {
            "word": (row[start] if start < len(row) else "").strip(),
            "phonetic": (row[start + 1] if start + 1 < len(row) else "").strip(),
            "meaning": (row[start + 2] if start + 2 < len(row) else "").strip(),
            "note": (row[start + 3] if start + 3 < len(row) else "").strip(),
        }

    return {
        "word": _get(row, word_idx),
        "phonetic": _get(row, phon_idx),
        "meaning": _get(row, mean_idx),
        "note": _get(row, note_idx),
    }


def _get(row, idx):
    if idx is None or idx >= len(row):
        return ""
    return (row[idx] or "").strip()


# ========== 释义清洗 ==========

def clean_meaning(raw: str) -> str:
    """
    欧陆词典的解释经常带词性前缀，如 "adj. 怀念的；向往的；渴望的"
    提取主要中文释义，去掉词性标签，取第一个分号前的内容。
    """
    if not raw:
        return ""
    # 去掉词性前缀（adj. n. v. vt. vi. adv. prep. conj. pron. int. art. num. det.）
    cleaned = re.sub(r"^(adj\.|n\.|v\.|vt\.|vi\.|adv\.|prep\.|conj\.|pron\.|int\.|art\.|num\.|det\.|abbr\.|aux\.|link\.v\.|modal\.v\.|interj\.|pl\.|sing\.)\s*", "", raw)
    # 取分号或逗号前的第一个释义
    first = re.split(r"[;；,，]", cleaned)[0].strip()
    # 去掉多余空格
    first = re.sub(r"\s+", " ", first)
    return first


def clean_phonetic(raw: str) -> str:
    """欧陆音标经常是 '英:/xxx/ 美:/xxx/'，取英式或第一个"""
    if not raw:
        return ""
    # 取 /.../ 内容
    m = re.search(r"/([^/]+)/", raw)
    if m:
        return "/" + m.group(1).strip() + "/"
    return raw.strip()


# ========== DeepSeek 批量调用 ==========

SYSTEM_PROMPT = """你是一个英语学习助手。根据给出的单词列表，为每个单词：
1. 生成 1 个自然、地道的英文例句（适合英语学习者）。如果提供了「备注」，**优先根据备注的语义/场景来生成例句**，让例句贴合备注的语境；如果没有备注，再根据中文释义自由生成。
2. 给出这个例句的中文翻译
3. 生成 3 个与该单词中文释义不同但容易混淆的干扰释义（干扰项要真实可信，像真的释义一样）

严格按 JSON 格式返回，不要任何其他解释文字。格式：
[{
  "word": "原单词",
  "sentence1": "英文例句",
  "sentence1Zh": "中文翻译",
  "distractor1": "干扰释义1",
  "distractor2": "干扰释义2",
  "distractor3": "干扰释义3"
}]"""


def build_user_prompt(batch: list[dict]) -> str:
    """把一批单词拼成 prompt（备注优先展示，让 AI 知道场景）"""
    lines = []
    for item in batch:
        meaning = item["meaning"] or "(无释义)"
        note = item["note"].strip() if item.get("note") else ""
        if note:
            lines.append(f"- {item['word']} | 释义: {meaning} | 备注/语境: {note}")
        else:
            lines.append(f"- {item['word']} | 释义: {meaning}")
    return "请为以下单词生成例句和干扰项（有备注的优先贴合备注语境）：\n" + "\n".join(lines)


def call_deepseek_batch(batch: list[dict], api_key: str) -> list[dict]:
    """调用 DeepSeek，返回补充了 sentence1/sentence1Zh/distractor1-3 的列表"""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_prompt(batch)},
        ],
        "stream": False,
        "temperature": 0.7,
    }

    resp = requests.post(API_URL, headers=headers, json=payload, timeout=60)
    resp.raise_for_status()
    data = resp.json()

    raw_content = data["choices"][0]["message"]["content"]

    # 提取 JSON（AI 可能包裹在 ```json ... ``` 里）
    match = re.search(r"```json?\s*(.*?)\s*```", raw_content, re.DOTALL)
    json_str = match.group(1) if match else raw_content

    # 有时候返回的是单个对象而不是数组
    json_str = json_str.strip()
    if json_str.startswith("{"):
        json_str = "[" + json_str + "]"

    parsed = json.loads(json_str)

    # 按 word 匹配回原始 batch
    result = []
    for item in batch:
        # 先在 parsed 里找匹配
        matched = next((p for p in parsed if p.get("word", "").lower() == item["word"].lower()), None)
        if matched:
            result.append({
                **item,
                "sentence1": matched.get("sentence1", "").strip(),
                "sentence1Zh": matched.get("sentence1Zh", "").strip(),
                "distractor1": matched.get("distractor1", "").strip(),
                "distractor2": matched.get("distractor2", "").strip(),
                "distractor3": matched.get("distractor3", "").strip(),
            })
        else:
            # 没匹配上的标记为空
            result.append({
                **item,
                "sentence1": "", "sentence1Zh": "",
                "distractor1": "", "distractor2": "", "distractor3": "",
            })
    return result


def call_deepseek_with_retry(batch: list[dict], api_key: str, max_retries: int = 3) -> list[dict]:
    for attempt in range(max_retries):
        try:
            return call_deepseek_batch(batch, api_key)
        except Exception as e:
            if attempt == max_retries - 1:
                print(f"  ❌ 批次失败（重试 {max_retries} 次后）: {e}")
                # 返回空填充的 batch
                return [{**b, "sentence1": "", "sentence1Zh": "",
                         "distractor1": "", "distractor2": "", "distractor3": ""} for b in batch]
            wait = 2 ** attempt
            print(f"  ⚠️ 批次出错，{wait}s 后重试: {e}")
            time.sleep(wait)


# ========== Excel 输出 ==========

EXCEL_HEADERS = [
    "单词", "音标", "中文释义", "例句1", "例句1翻译",
    "例句2", "例句2翻译", "备注", "干扰1", "干扰2", "干扰3",
]


def write_template_xlsx(rows: list[dict], output_path: str):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "单词"

    # 表头样式
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="4F46E5", end_color="4F46E5", fill_type="solid")

    for col, h in enumerate(EXCEL_HEADERS, 1):
        c = ws.cell(row=1, column=col, value=h)
        c.font = header_font
        c.fill = header_fill
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    # 数据行
    for r, item in enumerate(rows, 2):
        ws.cell(row=r, column=1, value=item.get("word", ""))
        ws.cell(row=r, column=2, value=item.get("phonetic", ""))
        ws.cell(row=r, column=3, value=item.get("meaning", ""))
        ws.cell(row=r, column=4, value=item.get("sentence1", ""))
        ws.cell(row=r, column=5, value=item.get("sentence1Zh", ""))
        ws.cell(row=r, column=6, value="")  # 例句2 留空
        ws.cell(row=r, column=7, value="")  # 例句2翻译 留空
        ws.cell(row=r, column=8, value=item.get("note", ""))
        ws.cell(row=r, column=9, value=item.get("distractor1", ""))
        ws.cell(row=r, column=10, value=item.get("distractor2", ""))
        ws.cell(row=r, column=11, value=item.get("distractor3", ""))

    # 列宽
    widths = [18, 22, 22, 45, 35, 45, 35, 20, 16, 16, 16]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w

    ws.row_dimensions[1].height = 24
    ws.freeze_panes = "A2"

    wb.save(output_path)


# ========== 主流程 ==========

def convert_csv_to_template(
    input_csv: str,
    output_xlsx: str | None = None,
    batch_size: int = 10,
    api_key: str | None = None,
    progress_callback=None,
) -> str:
    """
    完整转换流程：CSV → 解析 → AI 批量 → Excel 模板
    返回输出文件路径。
    """
    api_key = api_key or os.environ.get("ds_key") or os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        raise RuntimeError("未找到 API Key，请设置环境变量 ds_key")

    if not output_xlsx:
        p = Path(input_csv)
        output_xlsx = str(p.with_suffix(".xlsx"))

    def _log(msg):
        print(msg)
        if progress_callback:
            progress_callback(msg)

    # 1. 解析 CSV
    _log(f"📖 解析 CSV: {input_csv}")
    raw_rows = parse_eudic_csv(input_csv)
    _log(f"   共 {len(raw_rows)} 个单词")

    # 2. 清洗数据
    cleaned = []
    for r in raw_rows:
        w = r["word"].strip()
        if not w:
            continue
        cleaned.append({
            "word": w,
            "phonetic": clean_phonetic(r["phonetic"]),
            "meaning": clean_meaning(r["meaning"]),
            "note": r["note"].strip(),
        })
    _log(f"✅ 清洗后有效单词: {len(cleaned)}")

    # 3. 分批并发调 AI
    batches = []
    for i in range(0, len(cleaned), batch_size):
        batches.append((i // batch_size + 1, cleaned[i:i + batch_size]))
    total_batches = len(batches)

    _log(f"🚀 并发调用 {total_batches} 批（workers={MAX_WORKERS}）...")
    t0 = time.time()

    enriched = [None] * len(cleaned)  # 预分配保持顺序
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        future_map = {}
        for batch_num, batch in batches:
            future = pool.submit(call_deepseek_with_retry, batch, api_key)
            future_map[future] = (batch_num, batch)

        for future in as_completed(future_map):
            batch_num, batch = future_map[future]
            try:
                result = future.result()
                # 放回 enriched 对应位置
                start_idx = (batch_num - 1) * batch_size
                for j, r in enumerate(result):
                    enriched[start_idx + j] = r
                _log(f"  ✅ 批次 [{batch_num}/{total_batches}] 完成（{len(batch)} 个）")
            except Exception as e:
                _log(f"  ❌ 批次 [{batch_num}/{total_batches}] 失败: {e}")
                start_idx = (batch_num - 1) * batch_size
                for j, item in enumerate(batch):
                    enriched[start_idx + j] = {**item, "sentence1": "", "sentence1Zh": "",
                                              "distractor1": "", "distractor2": "", "distractor3": ""}

    _log(f"⏱️ AI 总耗时 {time.time() - t0:.1f}s（并发 {total_batches} 批）")

    # 4. 写出 Excel
    _log(f"📊 写出 Excel: {output_xlsx}")
    write_template_xlsx(enriched, output_xlsx)

    # 5. 统计
    ok = sum(1 for r in enriched if r.get("sentence1"))
    _log(f"🎉 完成！AI 成功生成 {ok}/{len(enriched)} 个例句")

    return output_xlsx


# ========== CLI ==========

def main():
    parser = argparse.ArgumentParser(description="欧陆词典 CSV → 背单词系统 Excel 模板")
    parser.add_argument("input", help="欧陆词典导出的 CSV 文件路径")
    parser.add_argument("-o", "--output", help="输出 Excel 路径（默认同名 .xlsx）")
    parser.add_argument("-b", "--batch-size", type=int, default=10, help="每批 AI 调用的单词数（默认 10）")
    args = parser.parse_args()

    try:
        out = convert_csv_to_template(args.input, args.output, args.batch_size)
        print(f"\n✅ 转换完成: {out}")
    except Exception as e:
        print(f"\n❌ 转换失败: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
