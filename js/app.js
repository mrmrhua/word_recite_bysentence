/**
 * app.js — 主入口
 * 页面切换、事件绑定、状态同步
 */

(function () {
  "use strict";

  // ========== 工具函数 ==========
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  function showToast(msg, ms = 2500) {
    const toast = $("#toast");
    toast.innerHTML = msg;
    toast.hidden = false;
    if (!msg.includes("<")) toast.textContent = msg;
    setTimeout(() => { toast.hidden = true; }, ms);
  }

  // 暴露给其他 JS 文件
  window.showToast = showToast;

  function switchPage(id) {
    $$(".page").forEach(p => p.classList.remove("active"));
    document.getElementById(id).classList.add("active");
    window.scrollTo(0, 0);
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  // ========== 初始化 ==========
  async function init() {
    try {
      // 双保险：强制隐藏弹窗和 toast
      document.getElementById("achievement-modal").hidden = true;
      document.getElementById("achievement-modal").style.display = "none";
      document.getElementById("toast").hidden = true;
      document.getElementById("toast").style.display = "none";

      // 并行：DB 和 Speaker 同时初始化，不互相等待
      // Speaker 即使慢也不阻塞 UI 渲染
      const dbPromise = DB.open();
      const speakerPromise = Speaker.init().catch(() => {}); // Speaker 失败忽略

      await dbPromise;   // 等 DB 就行，这个是必须的
      // Speaker.init() 在后台跑，好了之后自然能用

      await renderHome();
      bindHomeEvents();
      bindReviewEvents();
      bindSettingsEvents();
      bindWordsEvents();
      window.__onReviewFinish = onReviewFinish;
      console.log("✅ 语境背单词 初始化完成");
    } catch (err) {
      console.error("初始化失败:", err);
      showToast("⚠️ 数据库初始化失败：" + err.message);
    }
  }

  // ========== 首页渲染 ==========
  async function renderHome() {
    const settings = await DB.getSettings();

    // 同步音效设置
    Sound.setEnabled(settings.sound_enabled);

    // 统计卡片
    const totalCards = await DB.countCards();
    const degraded = await DB.countDegradedCards();
    $("#stat-total").textContent = totalCards;
    $("#stat-degraded").textContent = degraded;
    $("#stat-streak").textContent = settings.streak;

    // 今日进度：新词 + 复习词按设置分别取，取不到就取实际数量
    const todayCards = await DB.getTodayCards();
    const dueNew = todayCards.filter(c => !c.lastReviewedAt).length;
    const dueReview = todayCards.filter(c => c.lastReviewedAt).length;
    const planNew = Math.min(dueNew, settings.daily_new_goal);
    const planReview = Math.min(dueReview, settings.daily_review_limit);
    const planTotal = planNew + planReview;

    const todayDone = settings.last_review_date === todayStr()
      ? (settings._todayDone || 0)
      : 0;

    $("#progress-text").textContent =
      `${Math.min(todayDone, planTotal)} / ${planTotal}`;
    const pct = planTotal > 0 ? Math.min(100, todayDone / planTotal * 100) : 0;
    $("#progress-fill").style.width = pct + "%";

    if (totalCards === 0) {
      $("#progress-tip").textContent = "还没有待复习的卡片，先去导入单词吧";
    } else if (planTotal === 0) {
      $("#progress-tip").textContent = "今日没有待学的卡片，去加练或导入新词吧";
    } else if (todayDone >= planTotal) {
      $("#progress-tip").textContent = "🎉 今日目标已达成！明天再来～";
    } else {
      $("#progress-tip").textContent =
        `新词 ${planNew} · 复习 ${planReview}，共 ${planTotal} 张`;
    }

    // 学习总进度：初识（从未复习）= 未学；学习中 + 已斩 = 已学
    const allWords = await DB.getAllWords();
    const allWordCards = await DB.getAllCards();
    const cardMap = new Map();
    for (const c of allWordCards) {
      if (!cardMap.has(c.wordId)) cardMap.set(c.wordId, []);
      cardMap.get(c.wordId).push(c);
    }

    let cntUnlearned = 0, cntLearning = 0, cntDegradedWord = 0;
    for (const w of allWords) {
      const cs = cardMap.get(w.id);
      if (!cs || cs.length === 0) { cntUnlearned++; continue; }
      if (cs[0].isDegraded) cntDegradedWord++;
      else if (!cs[0].lastReviewedAt) cntUnlearned++;
      else cntLearning++;
    }

    const totalWords = allWords.length;
    const learnedWords = cntLearning + cntDegradedWord;
    const learnedPct = totalWords > 0 ? learnedWords / totalWords * 100 : 0;

    $("#overall-text").textContent =
      `已学 ${learnedWords} / ${totalWords} · ${Math.round(learnedPct)}%`;
    $("#overall-fill").style.width = learnedPct + "%";

    const legend = $("#overall-legend");
    legend.innerHTML = "";
    if (totalWords === 0) {
      legend.innerHTML = `<span class="mastery-item">暂无单词</span>`;
    } else {
      [
        { label: "初识（未学）", n: cntUnlearned, color: "#CBD5E1" },
        { label: "学习中", n: cntLearning, color: "#22C55E" },
        { label: "已斩", n: cntDegradedWord, color: "#64748B" }
      ].forEach(s => {
        if (s.n === 0) return;
        const pct = s.n / totalWords * 100;
        const item = document.createElement("span");
        item.className = "mastery-item";
        item.title = `${s.label} ${s.n} 个（${pct.toFixed(1)}%）`;
        item.innerHTML = `<i style="background:${s.color}"></i>${s.label} ${Math.round(pct)}%`;
        legend.appendChild(item);
      });
    }

    // 成就
    Achievements.renderPreview(
      $("#achievements-preview"),
      settings.achievements_unlocked || []
    );

    // 复习按钮状态
    const btnStart = $("#btn-start-review");
    if (planTotal === 0) {
      btnStart.innerHTML = `<span class="btn-icon">✨</span> 没有待学卡片`;
      btnStart.disabled = true;
      btnStart.style.opacity = "0.5";
      btnStart.style.cursor = "not-allowed";
    } else {
      btnStart.innerHTML = `<span class="btn-icon">▶</span> 开始复习（${planTotal}）`;
      btnStart.disabled = false;
      btnStart.style.opacity = "";
      btnStart.style.cursor = "";
    }
  }

  // ========== 首页事件 ==========
  function bindHomeEvents() {
    $("#btn-start-review").addEventListener("click", startReviewFlow);
    $("#btn-import").addEventListener("click", () => $("#file-input").click());
    $("#file-input").addEventListener("change", onFileSelected);
    $("#btn-backup").addEventListener("click", onBackup);
    $("#btn-settings").addEventListener("click", () => { loadSettingsPage(); switchPage("page-settings"); });

    $("#btn-consolidate").addEventListener("click", startConsolidateFlow);
    $("#btn-add-practice").addEventListener("click", addPracticeFlow);
    $("#btn-done-home").addEventListener("click", () => { switchPage("page-home"); renderHome(); });
    $("#btn-settings-back").addEventListener("click", () => { switchPage("page-home"); renderHome(); });
  }

  // ========== 复习启动流程 ==========
  async function startReviewFlow() {
    const settings = await DB.getSettings();
    const mode = settings.default_mode;
    const todayCards = await DB.getTodayCards();

    if (todayCards.length === 0) {
      showToast("🎉 今日没有待复习卡片！");
      switchPage("page-done");
      $("#done-title").textContent = "今日没有待复习卡片";
      $("#done-stats").innerHTML = "";
      return;
    }

    // 数量由 Review.start 按设置（新词数量 + 复习上限）自行组合
    const result = await Review.start(mode);
    if (result.empty) {
      showToast("今日没有待学的卡片");
      return;
    }

    Review.setInitialQueueLen(result.total);

    // 切换到复习页
    switchPage("page-review");
    // 选中正确的模式按钮
    $$(".mode-btn").forEach(b => b.classList.toggle(
      "active", b.dataset.mode === mode
    ));
    await Review.renderCurrent();
  }

  // 巩固模式：把最近 2 天答错的词捞出来再过一遍
  async function startConsolidateFlow() {
    const settings = await DB.getSettings();
    const mode = settings.default_mode;

    const result = await Review.start(mode, { source: "wrong" });
    if (result.empty) {
      showToast("最近两天没有答错的词");
      return;
    }

    Review.setInitialQueueLen(result.total);
    switchPage("page-review");
    $$(".mode-btn").forEach(b => b.classList.toggle(
      "active", b.dataset.mode === mode
    ));
    await Review.renderCurrent();
  }

  async function addPracticeFlow() {
    // 加练：复习降级卡片
    const result = await Review.start(Review.mode, { source: "degraded" });
    if (result.empty) {
      showToast("没有已斩的卡片");
      return;
    }
    Review.setInitialQueueLen(result.total);
    switchPage("page-review");
    await Review.renderCurrent();
  }

  // ========== 复习页事件 ==========
  function bindReviewEvents() {
    $("#btn-back-home").addEventListener("click", async () => {
      if (confirm("确定要退出本轮复习吗？当前进度会保存。")) {
        await finishReviewSession(false);
        switchPage("page-home");
        await renderHome();
      }
    });

    $$(".mode-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        $$(".mode-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        Review.mode = btn.dataset.mode;
        await Review.renderCurrent();
      });
    });
  }

  // ========== 文件导入 ==========
  async function onFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = ""; // reset

    try {
      showToast("⏳ 正在解析文件...", 3000);
      const rows = await Importer.parseFile(file);
      const valid = rows.filter(r => r.word && r.meaning && r.sentence1);
      if (valid.length === 0) {
        showToast("❌ 没有解析到有效行，请检查模板格式");
        return;
      }
      showToast(`⏳ 正在导入 ${valid.length} 行...`, 3000);
      const result = await DB.importRows(valid);

      // 更新统计 + 检查成就
      const settings = await DB.getSettings();
      await DB.setSettings({ total_reviews: settings.total_reviews });
      await checkAchievements();

      showToast(Importer.formatReport(result), 4000);
      await renderHome();
    } catch (err) {
      console.error("导入失败:", err);
      showToast("❌ 导入失败：" + err.message);
    }
  }

  // ========== 备份导出 ==========
  async function onBackup() {
    try {
      await Backup.export();
      showToast("✅ 备份已下载");
    } catch (err) {
      showToast("❌ 备份失败：" + err.message);
    }
  }

  // ========== 设置页 ==========
  async function loadSettingsPage() {
    const s = await DB.getSettings();
    $("#setting-new-goal").value = s.daily_new_goal;
    $("#setting-review-limit").value = s.daily_review_limit;
    $("#setting-sound").checked = s.sound_enabled;
    $("#setting-mode").value = s.default_mode;
    $("#setting-degrade-days").value = s.degrade_days;
  }

  function bindSettingsEvents() {
    $("#setting-new-goal").addEventListener("change", async () => {
      const n = Math.max(0, Math.min(100, parseInt($("#setting-new-goal").value) || 0));
      $("#setting-new-goal").value = n;
      await DB.setSettings({ daily_new_goal: n });
      showToast("已保存：每天学新词 " + n + " 个");
      await renderHome();
    });

    $("#setting-review-limit").addEventListener("change", async () => {
      const n = Math.max(0, Math.min(300, parseInt($("#setting-review-limit").value) || 0));
      $("#setting-review-limit").value = n;
      await DB.setSettings({ daily_review_limit: n });
      showToast("已保存：每天复习上限 " + n + " 个");
      await renderHome();
    });

    $("#setting-sound").addEventListener("change", async () => {
      const on = $("#setting-sound").checked;
      Sound.setEnabled(on);
      await DB.setSettings({ sound_enabled: on });
      if (on) Sound.correct();
    });

    $("#setting-mode").addEventListener("change", async () => {
      await DB.setSettings({ default_mode: $("#setting-mode").value });
      showToast("默认复习模式已更新");
    });

    $("#setting-degrade-days").addEventListener("change", async () => {
      await DB.setSettings({ degrade_days: parseInt($("#setting-degrade-days").value) });
    });

    $("#btn-clear-data").addEventListener("click", async () => {
      if (!confirm("⚠️ 这会删除所有单词、卡片、复习记录和设置！\n确定要清空吗？")) return;
      if (!confirm("⚠️ 再确认一次：此操作不可恢复！\n（建议先导出备份）")) return;
      await DB.clearAll();
      showToast("✅ 数据已清空");
      switchPage("page-home");
      await renderHome();
    });
  }

  // ========== 复习结束 ==========
  async function finishReviewSession(countAsComplete = true) {
    // 更新连续打卡
    if (countAsComplete) {
      const settings = await DB.getSettings();
      const today = todayStr();
      if (settings.last_review_date !== today) {
        let newStreak = settings.streak;
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        if (settings.last_review_date === yesterday.toISOString().slice(0, 10)) {
          newStreak = settings.streak + 1;
        } else {
          newStreak = 1;
        }
        await DB.setSettings({
          streak: newStreak,
          last_review_date: today
        });
      }

      await checkAchievements();
    }
  }

  async function onReviewFinish(stats) {
    await finishReviewSession(true);

    // 完成页
    const total = stats.total || 0;
    const rate = total > 0 ? Math.round(stats.correct / total * 100) : 0;
    const fuzzy = stats.fuzzy || 0;
    const wrong = stats.wrong || 0;

    Sound.complete();

    switchPage("page-done");
    $("#done-title").textContent = "🎉 今日复习完成！";
    $("#done-stats").innerHTML = `
      <div class="stat"><div class="stat-num">${total}</div><div class="stat-label">复习总数</div></div>
      <div class="stat"><div class="stat-num" style="color:var(--success)">${stats.correct}</div><div class="stat-label">答对</div></div>
      ${fuzzy > 0 ? `<div class="stat"><div class="stat-num" style="color:var(--warning)">${fuzzy}</div><div class="stat-label">模糊</div></div>` : ""}
      ${wrong > 0 ? `<div class="stat"><div class="stat-num" style="color:var(--danger)">${wrong}</div><div class="stat-label">错误</div></div>` : ""}
      <div class="stat"><div class="stat-num">${rate}%</div><div class="stat-label">正确率</div></div>
    `;

    await renderHome();
  }

  // ========== 成就检查 ==========
  async function checkAchievements() {
    const settings = await DB.getSettings();
    const totalCards = await DB.countCards();
    const degraded = await DB.countDegradedCards();
    const allCards = await DB.getAllCards();
    const uniqueWordIds = new Set(allCards.map(c => c.wordId));

    const stats = {
      total_reviews: settings.total_reviews,
      streak: settings.streak,
      unique_words: uniqueWordIds.size,
      total_degraded: settings.total_degraded
    };

    const newly = Achievements.checkNew(stats, settings.achievements_unlocked || []);
    if (newly.length > 0) {
      const unlocked = [...(settings.achievements_unlocked || []), ...newly.map(a => a.id)];
      await DB.setSettings({ achievements_unlocked: unlocked });

      // 显示成就弹窗
      const a = newly[0]; // 每次弹一个
      $("#achievement-icon").textContent = a.icon;
      $("#achievement-name").textContent = a.name;
      $("#achievement-modal").hidden = false;
      Sound.achievement();
      setTimeout(() => { $("#achievement-modal").hidden = true; }, 2500);
    }
  }

  // ========== 词汇表 ==========
  let _wordsSort = "createdAt_desc";
  let _selectedIds = new Set();

  // 根据卡片状态算熟练度等级 (0-5)
  function calcMastery(cards) {
    if (!cards || cards.length === 0) return { level: 0, label: "新词", color: "#9ca3af", rep: "-", interval: "-", ef: "-", due: "-" };
    // 取第一张卡的状态（同单词的卡通常一起复习）
    const c = cards[0];
    if (c.isDegraded) return { level: 0, label: "已斩", color: "#dc2626", rep: 0, interval: c.interval, ef: c.ef.toFixed(2), due: new Date(c.nextReviewAt).toLocaleDateString() };

    const rep = c.repetition;
    const interval = c.interval;
    const ef = c.ef;
    const due = new Date(c.nextReviewAt).toLocaleDateString();

    if (rep === 0) return { level: 1, label: "初识", color: "#f59e0b", rep, interval, ef: ef.toFixed(2), due };
    if (rep <= 2) return { level: 2, label: "学习中", color: "#ef4444", rep, interval, ef: ef.toFixed(2), due };
    if (rep <= 4) return { level: 3, label: "熟悉", color: "#22c55e", rep, interval, ef: ef.toFixed(2), due };
    if (rep <= 6) return { level: 4, label: "掌握", color: "#16a34a", rep, interval, ef: ef.toFixed(2), due };
    return { level: 5, label: "精通", color: "#15803d", rep, interval, ef: ef.toFixed(2), due };
  }

  // 熟练度分布：颜色 + 标签
  const MASTERY_STATS = [
    { key: "new", label: "新词", color: "#CBD5E1" },
    { key: "l1", label: "初识", color: "#FBBF24" },
    { key: "l2", label: "学习中", color: "#F97316" },
    { key: "l3", label: "熟悉", color: "#4ADE80" },
    { key: "l4", label: "掌握", color: "#22C55E" },
    { key: "l5", label: "精通", color: "#15803D" },
    { key: "degraded", label: "已斩", color: "#64748B" }
  ];

  function getMasteryKey(cards) {
    if (!cards || cards.length === 0) return "new";
    const c = cards[0];
    if (c.isDegraded) return "degraded";
    if (c.repetition === 0) return "l1";
    if (c.repetition <= 2) return "l2";
    if (c.repetition <= 4) return "l3";
    if (c.repetition <= 6) return "l4";
    return "l5";
  }

  /** 渲染熟练度占比条 + 图例 */
  function renderMasteryStats(allWords, cardsByWord) {
    const bar = $("#mastery-bar");
    const legend = $("#mastery-legend");
    bar.innerHTML = "";
    legend.innerHTML = "";

    const total = allWords.length;
    if (total === 0) {
      legend.innerHTML = `<span class="mastery-item">暂无数据</span>`;
      return;
    }

    const counts = {};
    MASTERY_STATS.forEach(s => { counts[s.key] = 0; });
    for (const w of allWords) {
      counts[getMasteryKey(cardsByWord[w.id])]++;
    }

    for (const s of MASTERY_STATS) {
      const n = counts[s.key];
      if (n === 0) continue;
      const pct = n / total * 100;

      const seg = document.createElement("div");
      seg.className = "mastery-seg";
      seg.style.width = pct + "%";
      seg.style.background = s.color;
      seg.title = `${s.label} ${n} 个（${pct.toFixed(1)}%）`;
      bar.appendChild(seg);

      const item = document.createElement("span");
      item.className = "mastery-item";
      item.innerHTML = `<i style="background:${s.color}"></i>${s.label} ${n} · ${Math.round(pct)}%`;
      legend.appendChild(item);
    }
  }

  async function renderWordsPage() {
    const allWords = await DB.getAllWords();
    const allCards = await DB.getAllCards();
    const totalCards = allCards.length;

    $("#words-total").textContent = allWords.length;
    $("#cards-total").textContent = totalCards;

    // 更新批量栏
    const batchInfo = $("#batch-info");
    const batchBar = $("#words-batch-bar");
    const hasSelection = _selectedIds.size > 0;
    batchInfo.hidden = !hasSelection;
    batchBar.hidden = !hasSelection;
    $("#batch-count").textContent = _selectedIds.size;

    const empty = $("#words-empty");
    const tbody = $("#words-tbody");
    tbody.innerHTML = "";

    // 搜索过滤
    const search = ($("#words-search").value || "").toLowerCase().trim();
    const cardsByWord = {};
    for (const c of allCards) {
      if (!cardsByWord[c.wordId]) cardsByWord[c.wordId] = [];
      cardsByWord[c.wordId].push(c);
    }

    // 熟练度占比（基于全部单词，不受搜索影响）
    renderMasteryStats(allWords, cardsByWord);

    let filtered = allWords;
    if (search) {
      filtered = allWords.filter(w => {
        if (w.word.toLowerCase().includes(search)) return true;
        if ((w.meaning || "").toLowerCase().includes(search)) return true;
        if ((w.note || "").toLowerCase().includes(search)) return true;
        const cards = cardsByWord[w.id] || [];
        return cards.some(c => (c.sentence || "").toLowerCase().includes(search));
      });
    }

    if (filtered.length === 0) {
      empty.hidden = false;
      $("#words-table-wrap").hidden = true;
      return;
    }
    empty.hidden = true;
    $("#words-table-wrap").hidden = false;

    filtered.sort((a, b) => {
      switch (_wordsSort) {
        case "createdAt_asc": return (a.createdAt || 0) - (b.createdAt || 0);
        case "createdAt_desc": return (b.createdAt || 0) - (a.createdAt || 0);
        case "word_asc": return a.word.localeCompare(b.word);
        case "word_desc": return b.word.localeCompare(a.word);
      }
    });

    for (const w of filtered) {
      const cards = cardsByWord[w.id] || [];
      const card1 = cards[0];
      const card2 = cards[1];
      const isDegraded = cards.length > 0 && cards.every(c => c.isDegraded);
      const mastery = calcMastery(cards);
      const checked = _selectedIds.has(w.id);

      const tr = document.createElement("tr");
      if (isDegraded) tr.classList.add("row-degraded");
      tr.dataset.wordId = w.id;

      // Checkbox 列
      const tdCheck = document.createElement("td");
      tdCheck.className = "col-check";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = checked;
      cb.addEventListener("change", () => {
        if (cb.checked) _selectedIds.add(w.id);
        else _selectedIds.delete(w.id);
        renderWordsPage();
      });
      tdCheck.appendChild(cb);

      const makeEditable = (value, onSave, placeholder = "-") => {
        const div = document.createElement("div");
        div.className = "editable";
        div.textContent = value || placeholder;
        div.contentEditable = "true";
        div.spellcheck = false;
        div.dataset.original = value || "";
        div.title = "点击编辑";
        let saved = false;
        const save = async () => {
          if (saved) return;
          const newVal = div.textContent.trim();
          if (newVal === (div.dataset.original || "")) return;
          saved = true;
          div.classList.add("saving");
          try {
            await onSave(newVal);
            div.dataset.original = newVal;
            div.classList.remove("saving");
            div.classList.add("saved");
            setTimeout(() => div.classList.remove("saved"), 800);
          } catch (err) {
            div.textContent = div.dataset.original || placeholder;
            div.classList.remove("saving");
            showToast("保存失败: " + err.message);
          }
        };
        div.addEventListener("blur", save);
        div.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); div.blur(); }
          if (e.key === "Escape") { div.textContent = div.dataset.original || placeholder; div.blur(); }
        });
        div.addEventListener("focus", () => {
          if (div.textContent === placeholder) div.textContent = "";
        });
        return div;
      };

      // 单词
      const tdWord = document.createElement("td");
      tdWord.className = "col-word";
      tdWord.innerHTML = `<b>${w.word}</b>
        ${typeof Speaker !== "undefined" && Speaker.speak ? `<button class="speak-btn" title="发音" data-word="${w.word}">🔊</button>` : ""}`;

      // 音标
      const tdPhonetic = document.createElement("td");
      tdPhonetic.className = "col-phonetic";
      tdPhonetic.appendChild(makeEditable(w.phonetic, (v) => DB.updateWord(w.id, { phonetic: v }), "-"));

      // 释义
      const tdMeaning = document.createElement("td");
      tdMeaning.className = "col-meaning";
      tdMeaning.appendChild(makeEditable(w.meaning, (v) => DB.updateWord(w.id, { meaning: v }), "-"));

      // 熟练度
      const tdMastery = document.createElement("td");
      tdMastery.className = "col-mastery";
      tdMastery.innerHTML = `
        <div class="mastery-bar" title="重复${mastery.rep}次,间隔${mastery.interval}天,ef=${mastery.ef},下次${mastery.due}">
          <div class="mastery-fill" style="width:${mastery.level * 20}%;background:${mastery.color}"></div>
        </div>
        <span class="mastery-label" style="color:${mastery.color}">${mastery.label}</span>
        <span class="mastery-detail">${mastery.interval}天 · ${mastery.rep}次</span>
      `;

      // 备注
      const tdNote = document.createElement("td");
      tdNote.className = "col-note-cell";
      tdNote.appendChild(makeEditable(w.note, (v) => DB.updateWord(w.id, { note: v }), "-"));

      // 例句1
      const tdS1 = document.createElement("td");
      tdS1.className = "col-sentence";
      tdS1.appendChild(card1 ? makeEditable(card1.sentence, (v) => DB.updateCard(card1.id, { sentence: v }), "-") : Object.assign(document.createElement("span"), { textContent: "-" }));

      // 例句2
      const tdS2 = document.createElement("td");
      tdS2.className = "col-sentence";
      tdS2.appendChild(card2 ? makeEditable(card2.sentence, (v) => DB.updateCard(card2.id, { sentence: v }), "-") : Object.assign(document.createElement("span"), { textContent: "-" }));

      // 操作
      const tdAction = document.createElement("td");
      tdAction.className = "col-action";
      const delBtn = document.createElement("button");
      delBtn.className = "btn-del";
      delBtn.title = "删除";
      delBtn.textContent = "🗑️";
      delBtn.onclick = async (e) => {
        e.stopPropagation();
        if (confirm(`确定删除 "${w.word}" 及其卡片？`)) {
          await DB.deleteWordAndCards(w.id);
          _selectedIds.delete(w.id);
          showToast("已删除");
          await renderWordsPage();
        }
      };
      tdAction.appendChild(delBtn);

      tr.appendChild(tdCheck);
      tr.appendChild(tdWord);
      tr.appendChild(tdPhonetic);
      tr.appendChild(tdMeaning);
      tr.appendChild(tdMastery);
      tr.appendChild(tdNote);
      tr.appendChild(tdS1);
      tr.appendChild(tdS2);
      tr.appendChild(tdAction);
      tbody.appendChild(tr);
    }

    // 发音按钮
    tbody.querySelectorAll(".speak-btn").forEach(btn => {
      btn.onclick = (e) => { e.stopPropagation(); Speaker.speak(btn.dataset.word); };
    });
  }

  function bindWordsEvents() {
    $("#btn-words").addEventListener("click", async () => { switchPage("page-words"); await renderWordsPage(); });
    $("#btn-words-back").addEventListener("click", async () => { switchPage("page-home"); await renderHome(); });
    $("#btn-words-import").addEventListener("click", () => $("#file-input").click());
    $("#words-sort-select").addEventListener("change", async (e) => { _wordsSort = e.target.value; await renderWordsPage(); });

    // 搜索防抖
    let searchTimer;
    $("#words-search").addEventListener("input", async () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderWordsPage, 300);
    });

    // 表头全选
    $("#th-check-all").addEventListener("change", (e) => {
      const checked = e.target.checked;
      // 获取当前筛选后的所有 wordId
      const rows = document.querySelectorAll("#words-tbody tr");
      rows.forEach(tr => {
        const id = tr.dataset.wordId;
        if (checked) _selectedIds.add(id);
        else _selectedIds.delete(id);
      });
      renderWordsPage();
    });

    // 批量全选当前
    $("#batch-select-all").addEventListener("change", async (e) => {
      if (!e.target.checked) {
        _selectedIds.clear();
      } else {
        // 选当前可见的全部
        const rows = document.querySelectorAll("#words-tbody tr");
        rows.forEach(tr => _selectedIds.add(tr.dataset.wordId));
      }
      await renderWordsPage();
    });

    // 批量删除
    $("#batch-delete").addEventListener("click", async () => {
      const ids = Array.from(_selectedIds);
      if (ids.length === 0) return;
      if (!confirm(`确定批量删除 ${ids.length} 个单词及其所有卡片？此操作不可撤销！`)) return;
      let done = 0;
      for (const id of ids) {
        try { await DB.deleteWordAndCards(id); done++; } catch {}
      }
      _selectedIds.clear();
      showToast(`✅ 已删除 ${done} 个`);
      await renderWordsPage();
    });

    // 取消选择
    $("#batch-cancel").addEventListener("click", async () => {
      _selectedIds.clear();
      await renderWordsPage();
    });
  }

  // ========== 启动 ==========
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
