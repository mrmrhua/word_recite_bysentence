/**
 * importer.js — Excel / CSV 导入
 * 依赖 SheetJS (xlsx) 库，CDN 引入
 *
 * 模板列名（第一行表头）：
 * 单词 | 音标 | 中文释义 | 例句1 | 例句1翻译 | 例句2 | 例句2翻译 | 备注
 */

const Importer = {
  // 标准列名映射（支持中英文表头 + 常见变体）
  COLUMN_MAP: {
    "单词": "word", "word": "word", "词": "word",
    "音标": "phonetic", "phonetic": "phonetic",
    "中文释义": "meaning", "meaning": "meaning", "释义": "meaning",
    "例句1": "sentence1", "例句": "sentence1", "sentence1": "sentence1",
    "例句1翻译": "sentence1Zh", "例句翻译": "sentence1Zh",
    "例句2": "sentence2",
    "例句2翻译": "sentence2Zh",
    "备注": "note", "note": "note",
    "干扰1": "distractor1", "干扰项1": "distractor1", "distractor1": "distractor1",
    "干扰2": "distractor2", "干扰项2": "distractor2", "distractor2": "distractor2",
    "干扰3": "distractor3", "干扰项3": "distractor3", "distractor3": "distractor3"
  },

  /**
   * 解析 File 对象为结构化行数据
   * @returns Promise<Array<{word, phonetic, meaning, sentence1, sentence1Zh, sentence2, sentence2Zh, note}>>
   */
  async parseFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: "array" });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
          resolve(rows.map(r => this._normalizeRow(r)));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error("文件读取失败"));
      reader.readAsArrayBuffer(file);
    });
  },

  /** 把原始 Excel 行（key 是列名）转成统一字段 */
  _normalizeRow(rawRow) {
    const row = {
      word: "", phonetic: "", meaning: "",
      sentence1: "", sentence1Zh: "",
      sentence2: "", sentence2Zh: "",
      note: ""
    };

    for (const [key, val] of Object.entries(rawRow)) {
      const lower = String(key).trim().toLowerCase();
      const target = this.COLUMN_MAP[String(key).trim()] || this.COLUMN_MAP[lower];
      if (target) {
        row[target] = String(val || "").trim();
      }
    }

    return row;
  },

  /** 生成导入报告的 HTML 片段（供 UI 展示） */
  formatReport(result) {
    const parts = [];
    parts.push(`✅ 成功导入 <b>${result.success}</b> 张卡片`);
    if (result.skipped > 0) parts.push(`⏭️ 跳过（重复或字段缺失）<b>${result.skipped}</b>`);
    if (result.failed > 0) parts.push(`❌ 失败 <b>${result.failed}</b>`);
    if (result.errors && result.errors.length > 0) {
      parts.push(`<details><summary>错误详情</summary><pre>${result.errors.slice(0, 10).join("\n")}</pre></details>`);
    }
    return parts.join("<br>");
  }
};
