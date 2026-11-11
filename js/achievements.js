/**
 * achievements.js — 成就判定
 * 写死简单成就，不搞复杂系统
 */

const Achievements = {
  LIST: [
    { id: "first_review", name: "初来乍到", icon: "🎯", desc: "完成第一次复习",
      check: (stats) => stats.total_reviews >= 1 },
    { id: "streak_7", name: "连续 7 天", icon: "🔥", desc: "连续 7 天完成复习",
      check: (stats) => stats.streak >= 7 },
    { id: "streak_30", name: "连续 30 天", icon: "💪", desc: "连续 30 天完成复习",
      check: (stats) => stats.streak >= 30 },
    { id: "words_100", name: "百词斩", icon: "📚", desc: "累计复习不同单词 ≥ 100",
      check: (stats) => stats.unique_words >= 100 },
    { id: "degraded_20", name: "斩词达人", icon: "🏆", desc: "累计降级 ≥ 20 张卡片",
      check: (stats) => stats.total_degraded >= 20 }
  ],

  /**
   * 检查并返回新解锁的成就
   * @param {object} stats  从 settings + cards 汇总出来的统计
   * @param {string[]} alreadyUnlocked
   * @returns {Array<{id, name, icon}>}
   */
  checkNew(stats, alreadyUnlocked) {
    const newly = [];
    for (const a of this.LIST) {
      if (!alreadyUnlocked.includes(a.id) && a.check(stats)) {
        newly.push({ id: a.id, name: a.name, icon: a.icon });
      }
    }
    return newly;
  },

  /** 渲染首页的成就预览条 */
  renderPreview(container, unlockedIds) {
    container.innerHTML = "";
    for (const a of this.LIST) {
      const chip = document.createElement("div");
      chip.className = "achievement-chip" + (unlockedIds.includes(a.id) ? " unlocked" : "");
      chip.title = a.desc;
      chip.innerHTML = `<span>${a.icon}</span><span>${a.name}</span>`;
      container.appendChild(chip);
    }
  }
};
