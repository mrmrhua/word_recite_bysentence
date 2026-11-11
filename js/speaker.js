/**
 * speaker.js — 单词语音
 * 优先在线 TTS（有道词典发音接口，返回真实 mp3），失败回退浏览器内置合成
 */

const Speaker = {
  _audio: null,       // 复用的 Audio 对象（在线发音）
  _supported: null,   // 是否支持系统 TTS
  _cachedVoice: null,

  init() {
    this._supported = "speechSynthesis" in window;
    if (!this._supported) return Promise.resolve();

    return new Promise((resolve) => {
      const pick = () => {
        const voices = speechSynthesis.getVoices();
        this._cachedVoice = voices.find(v => v.lang === "en-US") ||
                            voices.find(v => v.lang.startsWith("en")) ||
                            null;
      };
      pick();
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };
      speechSynthesis.onvoiceschanged = () => { pick(); done(); };
      setTimeout(() => { pick(); done(); }, 500);
    });
  },

  /**
   * 播放单词发音
   * @param {string} text 单词或短语
   */
  speak(text) {
    if (!text || !text.trim()) return;
    const word = text.trim();

    this._speakOnline(word).then(ok => {
      if (!ok) this._speakSystem(word);
    });
  },

  // ========== 方案 1：在线真人发音（有道） ==========
  _speakOnline(word) {
    return new Promise((resolve) => {
      try {
        if (!this._audio) {
          this._audio = new Audio();
          this._audio.preload = "auto";
          this._audio.volume = 1;
        }
        const a = this._audio;

        let settled = false;
        const finish = (ok) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          a.onerror = null;
          resolve(ok);
        };

        // 5 秒内拿不到音频就回退系统 TTS
        const timer = setTimeout(() => finish(false), 5000);

        a.onerror = () => finish(false);

        a.pause();
        a.src = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`;
        a.play()
          .then(() => finish(true))
          .catch(() => finish(false));
      } catch (e) {
        resolve(false);
      }
    });
  },

  // ========== 方案 2：系统 TTS（兜底） ==========
  _speakSystem(word) {
    if (!this._supported) return;
    try {
      speechSynthesis.cancel();

      const utter = new SpeechSynthesisUtterance(word);
      utter.lang = "en-US";
      utter.rate = 0.9;
      utter.pitch = 1;
      utter.volume = 1;
      if (this._cachedVoice) utter.voice = this._cachedVoice;
      utter.onerror = (e) => {
        if (e.error !== "interrupted" && e.error !== "canceled") {
          console.warn("[Speaker] error:", e.error);
        }
      };

      // 30ms 延迟，等 cancel 清理完成（规避 interrupted 竞争）
      setTimeout(() => {
        try { speechSynthesis.speak(utter); } catch (e) {}
      }, 30);
    } catch (e) {
      console.warn("[Speaker] fail:", e);
    }
  }
};
