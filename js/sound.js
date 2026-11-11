/**
 * sound.js — 音效反馈
 * 优先用本地 MP3 文件（sounds/*.mp3），加载失败 fallback 到 Web Audio API 合成
 */

const Sound = {
  _enabled: true,
  _audioCache: {},   // 预加载的 Audio 对象
  _fallbackTried: false,  // 是否已经检查过 MP3 是否存在

  // 音效映射表：函数名 → 文件名
  _files: {
    correct: "correct.mp3",
    wrong: "wrong.mp3",
    fuzzy: "fuzzy.mp3",
    complete: "complete.mp3",
    degrade: "degrade.mp3",
    achievement: "achievement.mp3"
  },

  setEnabled(enabled) {
    this._enabled = !!enabled;
  },

  /** 预加载所有 MP3（在页面首次交互后调用） */
  preload() {
    for (const [name, file] of Object.entries(this._files)) {
      const audio = new Audio(`sounds/${file}`);
      audio.preload = "auto";
      audio.volume = 0.6;
      // 静音加载测试，捕获错误
      audio.load();
      this._audioCache[name] = audio;
    }
  },

  /** 核心播放：优先 MP3，fallback 到合成 */
  _play(name) {
    if (!this._enabled) return;

    const audio = this._audioCache[name];
    if (audio) {
      try {
        audio.currentTime = 0;
        audio.play().catch(() => {
          // MP3 播放失败（可能文件不存在），fallback 到合成
          this._synthetic[name]?.call(this);
        });
        return;
      } catch {
        this._synthetic[name]?.call(this);
      }
    }
    // 没有预加载过，直接 fallback
    this._synthetic[name]?.call(this);
  },

  // ========== 对外 API ==========
  correct()   { this._play("correct"); },
  wrong()     { this._play("wrong"); },
  fuzzy()     { this._play("fuzzy"); },
  complete()  { this._play("complete"); },
  degrade()   { this._play("degrade"); },
  achievement() { this._play("achievement"); },

  // ========== Fallback：Web Audio API 合成 ==========
  _ctx: null,

  _getCtx() {
    if (!this._ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this._ctx = new AC();
    }
    if (this._ctx && this._ctx.state === "suspended") {
      this._ctx.resume();
    }
    return this._ctx;
  },

  _playTone(freq, duration, type = "sine", volume = 0.15, delay = 0) {
    if (!this._enabled) return;
    const ctx = this._getCtx();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.value = freq;

    const start = ctx.currentTime + delay;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(start);
    osc.stop(start + duration + 0.02);
  },

  _synthetic: {
    correct() {
      this._playTone(660, 0.12, "triangle", 0.12, 0);
      this._playTone(880, 0.18, "triangle", 0.12, 0.08);
    },
    wrong() {
      this._playTone(220, 0.25, "sine", 0.15);
    },
    fuzzy() {
      this._playTone(330, 0.15, "sine", 0.12);
    },
    complete() {
      this._playTone(523, 0.15, "triangle", 0.15, 0);
      this._playTone(659, 0.15, "triangle", 0.15, 0.15);
      this._playTone(784, 0.3, "triangle", 0.18, 0.3);
    },
    degrade() {
      this._playTone(300, 0.08, "square", 0.08);
      this._playTone(180, 0.12, "square", 0.08, 0.06);
    },
    achievement() {
      [523, 659, 784, 1047].forEach((f, i) => {
        this._playTone(f, 0.18, "sine", 0.12, i * 0.08);
      });
    }
  }
};

// 页面首次用户交互后预加载（浏览器自动播放策略要求）
document.addEventListener("click", function initSound() {
  Sound.preload();
  document.removeEventListener("click", initSound);
}, { once: true });
