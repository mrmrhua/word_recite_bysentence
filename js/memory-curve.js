/**
 * memory-curve.js — SM-2 记忆曲线算法（增强版）
 *
 * 优化点（相比标准 SM-2）：
 * 1. 选义答对 vs 速筛认识 → 不同的 ef 增量和间隔倍率（可信度不同）
 * 2. 晚来很多天还能答对 → 用真实延迟天数 × ef（说明记忆比预期强）
 * 3. 答错重置不变，但 ef 不惩罚
 *
 * 对外只暴露三个方法：calculate / degrade / undegrade
 */

const MemoryCurve = {
  /**
   * @param {Object} card ContextCard 对象
   * @param {"correct"|"wrong"|"fuzzy"} result 用户回答
   * @param {Object} [options]
   * @param {"choice"|"filter"} [options.mode] 复习模式，影响 ef 增量和间隔倍率
   */
  calculate(card, result, options = {}) {
    const updated = { ...card };
    const mode = options.mode || "choice";

    // 算真实延迟天数（用于"晚来还能答对"优化）
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const today = now.getTime();
    const expectedAt = card.nextReviewAt || today;
    const lateDays = Math.max(0, Math.round((today - expectedAt) / 86400000));

    if (result === "correct") {
      // ========== ef 增量：根据模式不同 ==========
      // 选义答对（4选1真认出来了）→ ef 增长快
      // 速筛认识（可能瞎蒙/犹豫）→ ef 保守增长
      const efDelta = mode === "choice" ? 0.10 : 0.02;
      updated.ef = Math.max(1.3, updated.ef + efDelta);

      // ========== interval 计算 ==========
      let interval;

      if (lateDays >= 3 && updated.repetition >= 2 && card.lastReviewedAt) {
        // 场景：晚来 3 天以上 + 已巩固过 2 次 + 答对
        // → 用真实复习间隔（今天 - 上次复习时间）作为 base，再 × ef
        const lastReviewed = new Date(card.lastReviewedAt);
        lastReviewed.setHours(0, 0, 0, 0);
        const realDays = Math.max(
          updated.interval,                                // 至少不小于原定 interval
          Math.round((today - lastReviewed.getTime()) / 86400000)  // 真实间隔
        );
        interval = Math.round(realDays * updated.ef);
      } else if (updated.repetition === 0) {
        interval = 1;
      } else if (updated.repetition === 1) {
        interval = 3;
      } else if (updated.repetition === 2) {
        interval = 7;
      } else {
        interval = Math.round(updated.interval * updated.ef);
      }

      // ========== 间隔倍率（mode ease factor） ==========
      // 选义答对 → ×1.6（真的记住了，拉长间隔）
      // 速筛认识 → ×1.2（可能不太确定，保守点）
      const easeFactor = mode === "choice" ? 1.6 : 1.2;
      interval = Math.max(interval, Math.round(interval * easeFactor));

      updated.interval = interval;
      updated.repetition += 1;
    } else {
      // 答错 / 模糊：都重置为 1 天
      updated.interval = 1;
      updated.repetition = 0;
      // 不惩罚 EF（公平原则：忘一次不代表难）
    }

    // 算 nextReviewAt
    updated.nextReviewAt = today + updated.interval * 86400000;
    updated.lastReviewedAt = Date.now();

    // 统计
    updated.totalReviews = (updated.totalReviews || 0) + 1;
    if (result === "correct") {
      updated.totalCorrect = (updated.totalCorrect || 0) + 1;
    }

    return updated;
  },

  // 降级（斩）：拉到极长周期
  degrade(card, days = 180) {
    const updated = { ...card };
    updated.isDegraded = true;
    updated.repetition = 0;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    updated.nextReviewAt = now.getTime() + days * 86400000;
    updated.lastReviewedAt = Date.now();
    return updated;
  },

  // 取消降级：立即回到今日队列
  undegrade(card) {
    const updated = { ...card };
    updated.isDegraded = false;
    updated.nextReviewAt = Date.now(); // 今天就可以复习
    return updated;
  }
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = MemoryCurve;
}
