/**
 * db.js — IndexedDB 封装
 * 数据库: word_recite
 * Object Stores: words, cards, logs, settings
 */

const DB = (() => {
  const DB_NAME = "word_recite";
  const DB_VERSION = 1;
  let _db = null;

  // ========== 初始化 ==========
  function open() {
    return new Promise((resolve, reject) => {
      if (_db) { resolve(_db); return; }

      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        if (!db.objectStoreNames.contains("words")) {
          const store = db.createObjectStore("words", { keyPath: "id" });
          store.createIndex("word", "word", { unique: true });
        }

        if (!db.objectStoreNames.contains("cards")) {
          const store = db.createObjectStore("cards", { keyPath: "id" });
          store.createIndex("wordId", "wordId", { unique: false });
          store.createIndex("nextReviewAt", "nextReviewAt", { unique: false });
          store.createIndex("isDegraded", "isDegraded", { unique: false });
        }

        if (!db.objectStoreNames.contains("logs")) {
          const store = db.createObjectStore("logs", { keyPath: "id" });
          store.createIndex("cardId", "cardId", { unique: false });
          store.createIndex("reviewedAt", "reviewedAt", { unique: false });
        }

        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
      };

      req.onsuccess = (e) => {
        _db = e.target.result;
        resolve(_db);
      };

      req.onerror = (e) => reject(e.target.error);
    });
  }

  function tx(storeName, mode = "readonly") {
    return _db.transaction(storeName, mode).objectStore(storeName);
  }

  function genId(prefix) {
    return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ========== Words ==========
  async function addWord(wordObj) {
    await open();
    return new Promise((resolve, reject) => {
      const store = tx("words", "readwrite");
      const req = store.add(wordObj);
      req.onsuccess = () => resolve(wordObj);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function getWord(id) {
    await open();
    return new Promise((resolve, reject) => {
      const req = tx("words").get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function getWordByText(word) {
    await open();
    return new Promise((resolve, reject) => {
      const req = tx("words").index("word").get(word);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function getAllWords() {
    await open();
    return new Promise((resolve, reject) => {
      const req = tx("words").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function countWords() {
    await open();
    return new Promise((resolve, reject) => {
      const req = tx("words").count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // ========== Cards ==========
  async function addCard(card) {
    await open();
    return new Promise((resolve, reject) => {
      const store = tx("cards", "readwrite");
      const req = store.add(card);
      req.onsuccess = () => resolve(card);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function updateCard(arg1, arg2) {
    await open();
    // 支持两种签名：updateCard(card) 或 updateCard(cardId, patch)
    let card;
    if (typeof arg2 === "object" && arg2 !== null) {
      const existing = await getCard(arg1);
      if (!existing) return null;
      card = { ...existing, ...arg2 };
    } else {
      card = arg1;
    }
    return new Promise((resolve, reject) => {
      const store = tx("cards", "readwrite");
      const req = store.put(card);
      req.onsuccess = () => resolve(card);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function getCard(id) {
    await open();
    return new Promise((resolve, reject) => {
      const req = tx("cards").get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function getAllCards() {
    await open();
    return new Promise((resolve, reject) => {
      const req = tx("cards").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function countCards() {
    await open();
    return new Promise((resolve, reject) => {
      const req = tx("cards").count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function countDegradedCards() {
    await open();
    // 注意：IndexedDB 不支持 Boolean 作为 key，改用 getAll + filter
    const all = await getAllCards();
    return all.filter(c => c.isDegraded).length;
  }

  /**
   * 获取今日待复习卡片（非降级 + nextReviewAt <= 今天 0 点）
   * 按 nextReviewAt 升序（最早过期的优先）
   */
  async function getTodayCards() {
    await open();
    return new Promise((resolve, reject) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayTs = today.getTime();

      const idx = tx("cards").index("nextReviewAt");
      const req = idx.getAll(IDBKeyRange.upperBound(todayTs));

      req.onsuccess = () => {
        // 过滤掉已降级的
        const result = (req.result || []).filter(c => !c.isDegraded);
        // 按 nextReviewAt 升序
        result.sort((a, b) => a.nextReviewAt - b.nextReviewAt);
        resolve(result);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /** 获取已降级的卡片（加练用） */
  async function getDegradedCards() {
    await open();
    // 注意：IndexedDB 不支持 Boolean 作为 key，改用 getAll + filter
    const all = await getAllCards();
    return all.filter(c => c.isDegraded);
  }

  // ========== Logs ==========
  async function addLog(log) {
    await open();
    return new Promise((resolve, reject) => {
      const store = tx("logs", "readwrite");
      const req = store.add(log);
      req.onsuccess = () => resolve(log);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function getAllLogs() {
    await open();
    return new Promise((resolve, reject) => {
      const req = tx("logs").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // ========== Settings ==========
  const DEFAULT_SETTINGS = {
    daily_new_goal: 10,      // 每天学习的新词数量
    daily_review_limit: 30,  // 每天复习旧词的上限
    sound_enabled: true,
    default_mode: "choice",
    degrade_days: 180,
    streak: 0,
    last_review_date: null,  // "2026-11-02" 格式
    achievements_unlocked: [],  // 已解锁成就 id 列表
    total_reviews: 0,
    total_correct: 0,
    total_degraded: 0
  };

  async function getSettings() {
    await open();
    return new Promise((resolve, reject) => {
      const req = tx("settings").get("config");
      req.onsuccess = () => {
        resolve({ ...DEFAULT_SETTINGS, ...(req.result || {}) });
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function setSettings(patch) {
    await open();
    const current = await getSettings();
    const merged = { ...current, ...patch };
    return new Promise((resolve, reject) => {
      const store = tx("settings", "readwrite");
      const req = store.put({ key: "config", ...merged });
      req.onsuccess = () => resolve(merged);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // ========== 导入事务 ==========
  /**
   * 批量导入：words + cards（单次事务，O(1) 去重）
   * 之前：每行 2-3 次事务 → 现在：1 次事务塞全部
   * @param {Array<{word, phonetic, meaning, sentence1, sentence1Zh, sentence2, sentence2Zh, note, distractor1, distractor2, distractor3}>} rows
   * @returns {{success: number, skipped: number, failed: number, errors: string[]}}
   */
  async function importRows(rows) {
    await open();

    // 第一步：预加载已有单词集合（O(1) 去重，避免每行 getWordByText 一次）
    const allExisting = await getAllWords();
    const existingSet = new Set(allExisting.map(w => w.word.toLowerCase()));

    // 第二步：预扫描 + 生成待写对象（不触碰 IndexedDB）
    const toWrite = []; // [{word, cards: []}]
    const result = { success: 0, skipped: 0, failed: 0, errors: [] };

    for (const row of rows) {
      if (!row.word || !row.meaning || !row.sentence1) {
        result.skipped++;
        result.errors.push(`缺少必填字段: ${row.word || "(无单词)"}`);
        continue;
      }

      if (existingSet.has(row.word.toLowerCase())) {
        result.skipped++;
        continue;
      }
      // 防止本次 Excel 内部重复（同一文件里出现两次同一单词）
      existingSet.add(row.word.toLowerCase());

      const wordObj = {
        id: genId("w"),
        word: row.word,
        phonetic: row.phonetic || "",
        meaning: row.meaning,
        note: row.note || "",
        distractor1: row.distractor1 || "",
        distractor2: row.distractor2 || "",
        distractor3: row.distractor3 || "",
        createdAt: Date.now()
      };

      const cards = [];
      if (row.sentence1) {
        cards.push(newCard(wordObj.id, row.sentence1, row.sentence1Zh || "", false));
      }
      if (row.sentence2) {
        cards.push(newCard(wordObj.id, row.sentence2, row.sentence2Zh || "", true));
      }

      toWrite.push({ word: wordObj, cards });
    }

    if (toWrite.length === 0) {
      return result;
    }

    // 第三步：单次 readwrite 事务批量写入
    await new Promise((resolve, reject) => {
      const tx = _db.transaction(["words", "cards"], "readwrite");
      const wordsStore = tx.objectStore("words");
      const cardsStore = tx.objectStore("cards");

      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);

      for (const { word, cards } of toWrite) {
        wordsStore.add(word);
        for (const card of cards) {
          cardsStore.add(card);
          result.success++;
        }
      }
    }).catch(err => {
      result.failed += toWrite.length;
      result.errors.push(`批量事务失败: ${err.message}`);
    });

    return result;
  }

  function newCard(wordId, sentence, sentenceZh, isSecond) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return {
      id: genId("c"),
      wordId,
      sentence,
      sentenceZh,
      isSecondExample: !!isSecond,
      ef: 2.5,
      interval: 0,
      repetition: 0,
      nextReviewAt: now.getTime(), // 今天就可以复习
      isDegraded: false,
      totalReviews: 0,
      totalCorrect: 0,
      createdAt: Date.now(),
      lastReviewedAt: null
    };
  }

  // ========== 清空全部 ==========
  async function clearAll() {
    await open();
    return new Promise((resolve, reject) => {
      const storeNames = ["words", "cards", "logs", "settings"];
      let done = 0;
      storeNames.forEach(name => {
        const req = tx(name, "readwrite").clear();
        req.onsuccess = () => { done++; if (done === storeNames.length) resolve(); };
        req.onerror = (e) => reject(e.target.error);
      });
    });
  }

  // ========== 导出 ==========
  async function exportAll() {
    await open();
    return {
      version: 1,
      exportedAt: Date.now(),
      words: await getAllWords(),
      cards: await getAllCards(),
      logs: await getAllLogs(),
      settings: await getSettings()
    };
  }

  // ========== 单词管理 ==========
  async function updateWord(wordId, patch) {
    await open();
    const word = await getWord(wordId);
    if (!word) return null;
    const updated = { ...word, ...patch };
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(["words"], "readwrite");
      tx.objectStore("words").put(updated);
      tx.oncomplete = () => resolve(updated);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async function deleteWordAndCards(wordId) {
    await open();
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(["words", "cards", "logs"], "readwrite");
      const wordsStore = tx.objectStore("words");
      const cardsStore = tx.objectStore("cards");
      const logsStore = tx.objectStore("logs");

      // 删 word
      wordsStore.delete(wordId);

      // 删关联 cards
      cardsStore.index("wordId").getAll(wordId).onsuccess = (e) => {
        for (const card of e.target.result) {
          cardsStore.delete(card.id);
          // 删关联 logs
          logsStore.index("cardId").getAll(card.id).onsuccess = (e2) => {
            for (const log of e2.target.result) logsStore.delete(log.id);
          };
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  /** 最近 N 天内答错的卡片（去重、按最近一次作答时间倒序、排除已斩） */
  async function getRecentWrongCards(days = 2) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    const startTs = start.getTime();

    const logs = await getAllLogs();
    const latest = new Map();   // cardId -> 最近一次答错的时间
    for (const l of logs) {
      if (l.result !== "wrong") continue;
      if ((l.reviewedAt || 0) < startTs) continue;
      if (!latest.has(l.cardId) || l.reviewedAt > latest.get(l.cardId)) {
        latest.set(l.cardId, l.reviewedAt);
      }
    }

    const picked = [];
    for (const [cardId, reviewedAt] of latest) {
      const c = await getCard(cardId);
      if (c && !c.isDegraded) picked.push({ card: c, reviewedAt });
    }

    return picked
      .sort((a, b) => b.reviewedAt - a.reviewedAt)
      .map(x => x.card);
  }

  return {
    open,
    genId,
    addWord, getWord, getWordByText, getAllWords, countWords,
    updateWord, updateCard, deleteWordAndCards,
    addCard, getCard, getAllCards, countCards, countDegradedCards,
    getTodayCards, getDegradedCards, getRecentWrongCards,
    addLog, getAllLogs,
    getSettings, setSettings, DEFAULT_SETTINGS,
    importRows, newCard,
    clearAll, exportAll
  };
})();
