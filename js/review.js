/**
 * review.js — 复习核心逻辑
 * 负责：队列管理、模式渲染、答题判定、调用记忆曲线、更新统计
 *
 * 模式：
 *   "choice" — 选义模式（4 选 1）
 *   "filter" — 速筛模式（认识 / 模糊 / 不认识）
 */

const Review = {
  queue: [],
  queueIdx: 0,
  mode: "choice",         // "choice" | "filter"
  sessionStats: { correct: 0, fuzzy: 0, wrong: 0, total: 0 },
  answering: false,
  peeked: false,          // 本轮是否只是「查看答案」而未作答
  lastAnswered: null,     // 上一个已作答的词 { card, word }
  _lastView: false,       // 是否正在回看上一个词

  async start(mode, options = {}) {
    this.mode = mode;
    this.queue = [];
    this.queueIdx = 0;
    this.sessionStats = { correct: 0, fuzzy: 0, wrong: 0, total: 0 };
    this.answering = false;
    this.peeked = false;
    this.lastAnswered = null;
    this._lastView = false;

    let cards;
    if (options.source === "degraded") {
      cards = await DB.getDegradedCards();
    } else if (options.source === "wrong") {
      // 巩固模式：最近 2 天答错的词
      cards = await DB.getRecentWrongCards(2);
    } else {
      // 新词 / 复习词按设置的数量分别取，再随机混排
      const settings = await DB.getSettings();
      const due = await DB.getTodayCards();
      const newCards = due.filter(c => !c.lastReviewedAt);
      const reviewCards = due.filter(c => c.lastReviewedAt);

      const nNew = Math.min(
        options.newLimit ?? settings.daily_new_goal,
        newCards.length
      );
      const nReview = Math.min(
        options.reviewLimit ?? settings.daily_review_limit,
        reviewCards.length
      );

      cards = this._shuffle([
        ...this._shuffle(newCards).slice(0, nNew),
        ...this._shuffle(reviewCards).slice(0, nReview)
      ]);
    }

    if (cards.length === 0) {
      return { empty: true };
    }

    this.queue = cards;
    return { empty: false, total: cards.length };
  },

  /** Fisher-Yates 洗牌（不修改原数组） */
  _shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },

  /** 渲染当前卡片 */
  async renderCurrent() {
    const card = this.queue[this.queueIdx];
    if (!card) return;

    const word = await DB.getWord(card.wordId);
    if (!word) return;

    // 每次渲染新题都重置答题锁（查看答案/编辑后重渲染时尤其重要）
    this.answering = false;
    this._lastView = false;
    document.getElementById("btn-continue").textContent = "下一题";

    // 右上角：上一个已答题的词汇
    const lastChip = document.getElementById("review-last-word");
    if (this.lastAnswered) {
      lastChip.textContent = this.lastAnswered.word.word;
      lastChip.hidden = false;
    } else {
      lastChip.hidden = true;
    }

    // 清掉上一题的闪光背景
    document.getElementById("quiz-view")
      .classList.remove("flash-correct", "flash-wrong", "flash-fuzzy");

    // 顶部进度
    const done = this.queueIdx;
    document.getElementById("review-progress").textContent =
      `${done + 1} / ${this.queue.length}`;
    document.getElementById("review-remaining").textContent =
      `还需 ${Math.max(1, this.queue.length - done)} 个`;

    // 答题态：单词 + 音标 + 例句 + 翻译
    document.getElementById("quiz-word").textContent = word.word;
    const phBox = document.getElementById("quiz-phonetic");
    if (word.phonetic) {
      phBox.innerHTML = `<span class="phonetic-tag">美</span><span>${word.phonetic}</span>`;
      phBox.hidden = false;
    } else {
      phBox.hidden = true;
    }
    document.getElementById("quiz-sentence").innerHTML =
      this._highlightWordSmart(card.sentence, word.word);
    // 答题时隐藏翻译，避免直接看出词义
    document.getElementById("quiz-translation").hidden = true;

    // 选项
    if (this.mode === "choice") {
      await this._renderChoiceOptions(word);
    } else {
      document.getElementById("choice-options").innerHTML = "";
    }

    this._setPanel("quiz");

    // 按钮绑定
    document.getElementById("card-speaker").onclick = () => Speaker.speak(word.word);
    document.getElementById("detail-speaker").onclick = () => Speaker.speak(word.word);
    document.getElementById("btn-peek-answer").onclick = () => this._peekAnswer();
    document.getElementById("btn-degrade-inline").onclick = () => this._degradeCurrent();
    document.getElementById("btn-quick-edit").onclick = () => this._openQuickEdit(card, word);
    document.getElementById("btn-filter-yes").onclick = () => this._answer("correct");
    document.getElementById("btn-filter-fuzzy").onclick = () => this._answer("fuzzy");
    document.getElementById("btn-filter-no").onclick = () => this._answer("wrong");
    document.getElementById("btn-continue").onclick = () => this._next();
    lastChip.onclick = () => this._viewLastAnswered();

    // 自动播放单词发音
    Speaker.speak(word.word);
  },

  /** 切换 答题态 / 详情态 */
  _setPanel(state) {
    const detail = state === "detail";
    const choiceMode = this.mode === "choice";

    document.getElementById("quiz-view").hidden = detail;
    document.getElementById("detail-view").hidden = !detail;
    document.getElementById("mode-switch").hidden = detail;
    document.getElementById("choice-options").hidden = detail || !choiceMode;
    document.getElementById("btn-peek-answer").hidden = detail || !choiceMode;
    document.getElementById("card-speaker").hidden = detail || !choiceMode;
    document.getElementById("filter-buttons").hidden = detail || choiceMode;
    document.getElementById("btn-continue").hidden = !detail;
  },

  /** 渲染详情面板（查看答案 / 答错 / 模糊） */
  async _renderDetailPanel(card, word) {
    document.getElementById("detail-word").textContent = word.word;

    const phBox = document.getElementById("detail-phonetic");
    if (word.phonetic) {
      phBox.innerHTML = `<span class="phonetic-tag">美</span><span>${word.phonetic}</span>`;
      phBox.hidden = false;
    } else {
      phBox.hidden = true;
    }

    document.getElementById("detail-meaning").textContent = word.meaning || "";

    const noteBlock = document.getElementById("detail-note-block");
    if (word.note) {
      document.getElementById("detail-note").textContent = word.note;
      noteBlock.hidden = false;
    } else {
      noteBlock.hidden = true;
    }

    document.getElementById("detail-sentence").innerHTML =
      this._highlightWordSmart(card.sentence, word.word);
    document.getElementById("detail-translation").textContent = card.sentenceZh || "";

    this._setPanel("detail");
  },

  // ========== 智能高亮/挖空（处理时态变化） ==========

  /**
   * 智能在例句中高亮目标单词（下划线）
   * 能匹配时态变化：run→running/ran, happy→happily, study→studies 等
   */
  _highlightWordSmart(sentence, baseWord) {
    const match = this._findWordOccurrence(sentence, baseWord);
    if (!match) return sentence;
    return sentence.slice(0, match.start) +
      `<span class="card-word">${match.text}</span>` +
      sentence.slice(match.end);
  },

  /**
   * 智能挖空（选义模式用）
   * 找到单词出现的位置，替换成 ______
   */
  _maskWordSmart(sentence, baseWord) {
    const match = this._findWordOccurrence(sentence, baseWord);
    if (!match) {
      // 没找到（比如完全不规则动词），还是高亮 base word 提示一下
      return sentence;
    }
    return sentence.slice(0, match.start) +
      `<span class="card-blank">______</span>` +
      sentence.slice(match.end);
  },

  /**
   * 在句子中找到 baseWord 或其常见变形的第一个出现位置
   * 处理：run→running/runs, happy→happily, study→studies/studied, make→making/made 等
   * @returns {{start, end, text} | null}
   */
  _findWordOccurrence(sentence, baseWord) {
    const escaped = this._escapeRegex(baseWord);

    // 1. 精确匹配原单词
    let regex = new RegExp("\\b(" + escaped + ")\\b", "i");
    let m = regex.exec(sentence);
    if (m) return { start: m.index, end: m.index + m[0].length, text: m[0] };

    // 2. 构造包含常见屈折变化的正则
    const patterns = [];

    // 2a. 辅音+y 结尾 → 变 ies/ied/ily/iness 等
    const yEnding = baseWord.endsWith("y") && !/[aeiou]y$/i.test(baseWord);
    if (yEnding) {
      const stemY = baseWord.slice(0, -1);
      patterns.push(stemY + "(ies|ied|ily|iness|iment|ition)");
    }

    // 2b. 以 e 结尾 → 两种可能：直接加后缀 或 去 e 加后缀
    if (baseWord.endsWith("e") && baseWord.length > 2) {
      const stemE = baseWord.slice(0, -1);
      patterns.push(stemE + "(ing|ed|able|ably)");   // make→making, close→closing
    }

    // 2c. 重读闭音节（辅元辅）→ 双写尾字母 + ing/ed
    const doubled = /[bcdfghjklmnpqrstvwxyz][aeiou][bcdfghjklmnpqrstvwxyz]$/i.test(baseWord);
    if (doubled) {
      const stemDouble = baseWord + baseWord.slice(-1);
      patterns.push(stemDouble + "(ing|ed|er|est)");  // run→running, big→bigger
    }

    // 2d. 通用后缀（直接在 base 上加 s/es/ed/ing/ly/er/est/ness/ment/tion）
    patterns.push(escaped + "(s|es|ed|ing|ly|er|est|ness|ment|tion)");

    const combined = "\\b(" + patterns.join("|") + ")\\b";
    regex = new RegExp(combined, "i");
    m = regex.exec(sentence);
    if (m) return { start: m.index, end: m.index + m[0].length, text: m[0] };

    return null;
  },

  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  },

  // ========== 选义模式 ==========

  /**
   * 生成 4 个选项：优先用用户在 Excel 里给的干扰项，不够再从词库随机补
   */
  async _renderChoiceOptions(word) {
    const container = document.getElementById("choice-options");
    container.innerHTML = "";
    const correctMeaning = word.meaning;

    // 1. 用户自定义干扰项（去重！也不能和正确答案一样）
    const userDistractors = [...new Set([word.distractor1, word.distractor2, word.distractor3]
      .filter(d => d && String(d).trim() && String(d).trim() !== correctMeaning)
      .map(d => String(d).trim()))];

    // 2. 从词库随机补（全链路去重）
    const allWords = await DB.getAllWords();
    const existingSet = new Set([correctMeaning, ...userDistractors]);
    const pool = [...new Set(
      allWords
        .map(w => w.meaning)
        .filter(m => m && !existingSet.has(m))
    )];
    const shuffledPool = pool.sort(() => Math.random() - 0.5);

    // 3. 合并到 3 个
    const distractors = [...userDistractors];
    for (const d of shuffledPool) {
      if (distractors.length >= 3) break;
      distractors.push(d);
    }
    while (distractors.length < 3) {
      distractors.push(`选项 ${distractors.length + 1}`);
    }

    // 4. 正确 + 3 干扰，乱序（最终去重兜底）
    const options = [...new Set([correctMeaning, ...distractors])].sort(() => Math.random() - 0.5);

    options.forEach((optText) => {
      const btn = document.createElement("button");
      btn.className = "choice-option";
      btn.textContent = optText;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._onChoiceClick(optText, correctMeaning, btn);
      }, { passive: false });
      container.appendChild(btn);
    });
  },

  _onChoiceClick(selected, correctMeaning, btn) {
    if (this.answering) return;
    this.answering = true;

    const container = document.getElementById("choice-options");
    const buttons = container.querySelectorAll(".choice-option");
    const isCorrect = selected === correctMeaning;

    buttons.forEach(b => {
      b.disabled = true;
      if (b.textContent.includes(correctMeaning)) b.classList.add("correct");
      if (b === btn && !isCorrect) b.classList.add("wrong");
    });

    setTimeout(() => this._answer(isCorrect ? "correct" : "wrong"), 400);
  },

  // ========== 答题处理 ==========

  /**
   * @param {"correct"|"wrong"|"fuzzy"} result
   */
  async _answer(result) {
    this.answering = false;
    this.peeked = false;
    this._lastView = false;

    const card = this.queue[this.queueIdx];
    const cardEl = document.getElementById("quiz-view");

    // 闪屏
    cardEl.classList.remove("flash-correct", "flash-wrong", "flash-fuzzy");
    void cardEl.offsetWidth;
    cardEl.classList.add(result === "correct" ? "flash-correct" :
                         result === "fuzzy" ? "flash-fuzzy" : "flash-wrong");

    // 音效
    Sound[result === "correct" ? "correct" : result === "fuzzy" ? "fuzzy" : "wrong"]();

    // 统计
    this.sessionStats.total++;
    if (result === "correct") this.sessionStats.correct++;
    else if (result === "fuzzy") this.sessionStats.fuzzy++;
    else this.sessionStats.wrong++;

    // 记忆曲线
    const updatedCard = MemoryCurve.calculate(card, result, { mode: this.mode });
    await DB.updateCard(updatedCard);

    // ✅ 关键：同步回 queue 里的对象，否则 _next() 读到的是旧 interval/repetition
    Object.assign(card, {
      interval: updatedCard.interval,
      repetition: updatedCard.repetition,
      ef: updatedCard.ef,
      nextReviewAt: updatedCard.nextReviewAt,
      lastReviewedAt: updatedCard.lastReviewedAt
    });

    // 日志
    await DB.addLog({
      id: DB.genId("l"),
      cardId: card.id,
      result,
      reviewMode: this.mode,
      reviewedAt: Date.now()
    });

    // 全局统计
    const s = await DB.getSettings();
    await DB.setSettings({
      total_reviews: s.total_reviews + 1,
      total_correct: s.total_correct + (result === "correct" ? 1 : 0)
    });

    // 记住这个已作答的词，供右上角回看
    const answeredWord = await DB.getWord(card.wordId);
    if (answeredWord) this.lastAnswered = { card, word: answeredWord };

    // 不论对错，都展示答案详情，由用户手动点「下一题」
    await this._showDetail(card);
  },

  // ========== 选义模式操作 ==========

  /** 主动查看答案（不记分、不判对错，纯查看） */
  async _peekAnswer() {
    const card = this.queue[this.queueIdx];
    const word = await DB.getWord(card.wordId);

    Sound.fuzzy();
    this.peeked = true;
    await this._renderDetailPanel(card, word);
  },

  async _showDetail(card) {
    const word = await DB.getWord(card.wordId);
    await this._renderDetailPanel(card, word);
  },

  /** 回看上一个已答题的答案页 */
  async _viewLastAnswered() {
    if (!this.lastAnswered) return;
    const card = this.lastAnswered.card;
    const word = await DB.getWord(card.wordId) || this.lastAnswered.word;

    this._lastView = true;
    await this._renderDetailPanel(card, word);
    document.getElementById("btn-continue").textContent = "继续答题";
  },

  async _next() {
    this.answering = false;  // 重置锁（peek 或答题后可能残留）

    // 正在回看上一个词 → 回到当前未作答的题
    if (this._lastView) {
      this._lastView = false;
      await this.renderCurrent();
      return;
    }

    // 只是查看过答案、并未作答 → 回到同一道题重新作答
    if (this.peeked) {
      this.peeked = false;
      await this.renderCurrent();
      return;
    }

    const currentCard = this.queue[this.queueIdx];
    // 如果刚答的是 模糊/错误（interval 被重置为 1 天），移到队尾
    if (currentCard.interval === 1 && currentCard.repetition === 0) {
      const moved = this.queue.splice(this.queueIdx, 1)[0];
      this.queue.push(moved);
    } else {
      this.queueIdx++;
    }

    if (this.queueIdx >= this.queue.length) {
      if (this.queue.length > 3 * (this._initialQueueLen || Infinity)) {
        this._finish();
        return;
      }
      this._finish();
      return;
    }

    await this.renderCurrent();
  },

  async _degradeCurrent() {
    this.peeked = false;
    const card = this.queue[this.queueIdx];
    const settings = await DB.getSettings();
    const degraded = MemoryCurve.degrade(card, settings.degrade_days);
    await DB.updateCard(degraded);

    const s = await DB.getSettings();
    await DB.setSettings({ total_degraded: s.total_degraded + 1 });

    Sound.degrade();

    // 降级后从队列里移除
    this.queue.splice(this.queueIdx, 1);
    if (this.queueIdx >= this.queue.length) {
      if (this.queue.length === 0) { this._finish(); return; }
      this.queueIdx = 0;
    }
    await this.renderCurrent();
  },

  setInitialQueueLen(n) {
    this._initialQueueLen = n;
  },

  _finish() {
    if (typeof window.__onReviewFinish === "function") {
      window.__onReviewFinish(this.sessionStats);
    }
  },

  // ========== 快捷编辑 ==========
  _openQuickEdit(card, word) {
    DB.getAllCards().then(allCards => {
      const cardsByWord = {};
      for (const c of allCards) {
        if (!cardsByWord[c.wordId]) cardsByWord[c.wordId] = [];
        cardsByWord[c.wordId].push(c);
      }
      const cards = cardsByWord[word.id] || [];
      const c1 = cards[0];
      const c2 = cards[1];

      const $ = (id) => document.getElementById(id);

      $("edit-word-label").textContent = word.word;
      $("edit-phonetic").value = word.phonetic || "";
      $("edit-meaning").value = word.meaning || "";
      $("edit-note").value = word.note || "";
      $("edit-distractor1").value = word.distractor1 || "";
      $("edit-distractor2").value = word.distractor2 || "";
      $("edit-distractor3").value = word.distractor3 || "";
      $("edit-sentence1").value = c1?.sentence || "";
      $("edit-sentence1Zh").value = c1?.sentenceZh || "";
      $("edit-sentence2").value = c2?.sentence || "";
      $("edit-sentence2Zh").value = c2?.sentenceZh || "";

      const modal = $("edit-modal");
      modal.hidden = false;

      const close = () => { modal.hidden = true; };
      $("edit-cancel").onclick = close;
      modal.querySelector(".edit-modal-mask").onclick = close;

      $("edit-save").onclick = async () => {
        await DB.updateWord(word.id, {
          phonetic: $("edit-phonetic").value.trim(),
          meaning: $("edit-meaning").value.trim(),
          note: $("edit-note").value.trim(),
          distractor1: $("edit-distractor1").value.trim(),
          distractor2: $("edit-distractor2").value.trim(),
          distractor3: $("edit-distractor3").value.trim()
        });
        if (c1) {
          await DB.updateCard(c1.id, {
            sentence: $("edit-sentence1").value.trim(),
            sentenceZh: $("edit-sentence1Zh").value.trim()
          });
        }
        if (c2) {
          await DB.updateCard(c2.id, {
            sentence: $("edit-sentence2").value.trim(),
            sentenceZh: $("edit-sentence2Zh").value.trim()
          });
        }
        close();
        showToast("✅ 已保存");
        await this.renderCurrent();
      };
    });
  }
};
