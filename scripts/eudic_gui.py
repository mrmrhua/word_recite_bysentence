"""
eudic_gui.py — 欧陆词典 CSV → 背单词系统 Excel 模板（桌面版）

依赖：tkinter（Python 自带）、requests、openpyxl
运行：python eudic_gui.py
"""

import os
import sys
import threading
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, scrolledtext

# 确保能 import 同目录下的 converter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eudic_converter import convert_csv_to_template


class ConverterApp:
    def __init__(self, root: tk.Tk, font_log=("Consolas", 20)):
        self.root = root
        self.root.title("欧陆词典 → 背单词模板")
        self.root.geometry("800x680")
        self.root.configure(padx=24, pady=20)
        self.root.resizable(False, False)

        self.font_log = font_log

        self.input_var = tk.StringVar()
        self.output_var = tk.StringVar()
        self.batch_var = tk.IntVar(value=10)
        self.api_var = tk.StringVar(value=os.environ.get("ds_key", ""))
        self.running = False

        self._build_ui()

    def _build_ui(self):
        # ========== 输入文件 ==========
        frm1 = ttk.LabelFrame(self.root, text="1. 选择欧陆词典 CSV")
        frm1.pack(fill="x", pady=(0, 8))

        ttk.Entry(frm1, textvariable=self.input_var).pack(side="left", fill="x", expand=True, padx=(10, 6), pady=8)
        ttk.Button(frm1, text="浏览...", width=10, command=self._choose_input).pack(side="right", padx=(0, 10), pady=8)

        # ========== 输出文件 ==========
        frm2 = ttk.LabelFrame(self.root, text="2. 输出 Excel（可选，默认同名 .xlsx）")
        frm2.pack(fill="x", pady=(0, 8))

        ttk.Entry(frm2, textvariable=self.output_var).pack(side="left", fill="x", expand=True, padx=(10, 6), pady=8)
        ttk.Button(frm2, text="另存为...", width=10, command=self._choose_output).pack(side="right", padx=(0, 10), pady=8)

        # ========== 设置 ==========
        frm3 = ttk.LabelFrame(self.root, text="3. 设置")
        frm3.pack(fill="x", pady=(0, 8))

        ttk.Label(frm3, text="API Key").grid(row=0, column=0, sticky="w", padx=(10, 6), pady=6)
        ttk.Entry(frm3, textvariable=self.api_var, show="*", width=40).grid(row=0, column=1, sticky="we", padx=(0, 10), pady=6)

        ttk.Label(frm3, text="每批单词数").grid(row=0, column=2, padx=(10, 6), pady=6)
        ttk.Spinbox(frm3, from_=3, to=30, textvariable=self.batch_var, width=5).grid(row=0, column=3, padx=(0, 10), pady=6)

        # ========== 运行 ==========
        self.run_btn = ttk.Button(self.root, text="🚀 开始转换", command=self._start)
        self.run_btn.pack(fill="x", pady=(4, 8))

        # ========== 日志 ==========
        frm4 = ttk.LabelFrame(self.root, text="运行日志")
        frm4.pack(fill="both", expand=True, pady=(0, 4))

        self.log_box = scrolledtext.ScrolledText(frm4, height=10, state="disabled", wrap="word", font=self.font_log)
        self.log_box.pack(fill="both", expand=True, padx=8, pady=8)

    # ========== 事件 ==========

    def _choose_input(self):
        path = filedialog.askopenfilename(
            title="选择欧陆词典 CSV",
            filetypes=[("CSV 文件", "*.csv"), ("所有文件", "*.*")],
        )
        if path:
            self.input_var.set(path)
            # 自动填输出
            if not self.output_var.get():
                self.output_var.set(os.path.splitext(path)[0] + ".xlsx")

    def _choose_output(self):
        path = filedialog.asksaveasfilename(
            title="保存为 Excel",
            defaultextension=".xlsx",
            filetypes=[("Excel 文件", "*.xlsx")],
        )
        if path:
            self.output_var.set(path)

    def _start(self):
        if self.running:
            return
        csv_path = self.input_var.get().strip()
        if not csv_path or not os.path.exists(csv_path):
            messagebox.showwarning("提示", "请选择有效的 CSV 文件")
            return
        api_key = self.api_var.get().strip() or os.environ.get("ds_key", "")
        if not api_key:
            messagebox.showwarning("提示", "请填写 API Key 或设置环境变量 ds_key")
            return

        self.running = True
        self.run_btn.config(state="disabled", text="转换中...")
        self._log_clear()

        t = threading.Thread(target=self._run_convert, args=(csv_path, api_key), daemon=True)
        t.start()

    def _run_convert(self, csv_path, api_key):
        try:
            out = convert_csv_to_template(
                input_csv=csv_path,
                output_xlsx=self.output_var.get().strip() or None,
                batch_size=self.batch_var.get(),
                api_key=api_key,
                progress_callback=self._log,
            )
            self.root.after(0, self._on_done, True, out)
        except Exception as e:
            self.root.after(0, self._on_done, False, str(e))

    def _on_done(self, success, msg):
        self.running = False
        self.run_btn.config(state="normal", text="🚀 开始转换")
        if success:
            self._log(f"\n✅ 完成! 输出文件: {msg}")
            messagebox.showinfo("完成", f"转换成功！\n\n{msg}")
        else:
            self._log(f"\n❌ 失败: {msg}")
            messagebox.showerror("失败", str(msg))

    # ========== 日志 ==========

    def _log(self, text: str):
        self.root.after(0, self._do_log, text)

    def _do_log(self, text: str):
        self.log_box.config(state="normal")
        self.log_box.insert("end", text + "\n")
        self.log_box.see("end")
        self.log_box.config(state="disabled")

    def _log_clear(self):
        self.log_box.config(state="normal")
        self.log_box.delete("1.0", "end")
        self.log_box.config(state="disabled")


def main():
    root = tk.Tk()
    # Windows 高 DPI 适配
    try:
        from ctypes import windll
        windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass

    # 统一放大所有控件字体
    FONT_BASE = ("Microsoft YaHei UI", 22)
    FONT_TITLE = ("Microsoft YaHei UI", 24, "bold")
    FONT_LOG = ("Consolas", 20)

    try:
        style = ttk.Style()
        style.theme_use("vista" if sys.platform.startswith("win") else "clam")
        style.configure(".", font=FONT_BASE)
        style.configure("TLabelframe.Label", font=FONT_TITLE)
        style.configure("TLabel", font=FONT_BASE)
        style.configure("TButton", font=FONT_BASE, padding=10)
        style.configure("TEntry", font=FONT_BASE, padding=8)
        style.configure("TSpinbox", font=FONT_BASE, padding=8)
    except Exception:
        pass

    ConverterApp(root, FONT_LOG)
    root.mainloop()


if __name__ == "__main__":
    main()
