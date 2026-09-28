/*!
 * clrc-player.js
 * YouTube 動画の再生に同期して CLRC ファイルの歌詞を表示する。
 * 先に clrc-parser.js を読み込んでおくこと。
 *
 * 使い方 (どちらか一方):
 *   <div class="clrc-player" data-video-id="動画ID" data-src="song.clrc"></div>
 *
 *   <div class="clrc-player" data-video-id="動画ID">
 *     <script type="text/plain">
 *     [00:10.00]C:歌詞...
 *     </script>
 *   </div>
 *
 * data-video-id には動画の URL をそのまま書いてもよい。
 * clrc ファイルに [yt:動画ID] がある場合、data-video-id は省略できる。
 * 両方ある場合は data-video-id を優先する。
 * data-debug="true" を付けると、clrc ファイルの警告を歌詞の下に表示する。
 */
(function () {
  'use strict';

  const STYLE_ID = 'clrc-player-style';
  const USER_SCROLL_PAUSE_MS = 3000;

  const CSS = `
.clrc-player {
  width: 100%;
  max-width: 640px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 10px rgba(0,0,0,0.1);
  overflow: hidden;
  margin: 0 auto;
}
.clrc-video {
  position: relative;
  width: 100%;
  padding-bottom: 56.25%; /* 16:9 */
  background-color: #000;
}
.clrc-video > * {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}
.clrc-lyrics {
  height: 300px;
  overflow-y: auto;
  padding: 20px;
  background-color: #222;
  position: relative;
  line-height: 1.5;
}
.clrc-line {
  display: flex;
  align-items: baseline;
  margin-bottom: 12px;
  cursor: pointer;
  opacity: 0.5;
  transition: opacity 0.3s ease;
}
.clrc-line:hover {
  opacity: 0.8;
}
.clrc-line.active {
  opacity: 1;
}
.clrc-line.clrc-info {
  opacity: 1;
}
.clrc-line.clrc-info:hover {
  opacity: 0.8;
}
.clrc-info-text {
  font-size: 0.9rem;
  white-space: pre-wrap;
}
.clrc-part {
  font-size: 0.8em;
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 4px;
  margin-right: 10px;
  color: #fff;
  white-space: nowrap;
}
.clrc-seg {
  font-size: 1.1rem;
  font-weight: bold;
  white-space: pre-wrap;
  --progress: 0%;
  --active-color: #ffffff;
  --default-color: #777777;
  background: linear-gradient(
    to right,
    var(--active-color) 0%,
    var(--active-color) var(--progress),
    var(--default-color) var(--progress),
    var(--default-color) 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  display: inline-block;
}
.clrc-message {
  color: #ff9999;
  font-size: 0.9rem;
  white-space: pre-wrap;
}
`;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // 動画 ID のほか、watch / youtu.be / embed / shorts / live の URL を受け付ける
  function extractVideoId(value) {
    const text = (value || '').trim();
    const match = text.match(/(?:[?&]v=|youtu\.be\/|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/);
    return match ? match[1] : text;
  }

  let youTubeApiPromise = null;
  function loadYouTubeAPI() {
    if (youTubeApiPromise) return youTubeApiPromise;
    youTubeApiPromise = new Promise((resolve) => {
      const ready = () => typeof YT !== 'undefined' && typeof YT.Player === 'function';
      if (!ready() && !document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
      // onYouTubeIframeAPIReady は他のスクリプトと取り合いになるので使わずに待つ
      (function wait() {
        if (ready()) resolve(YT);
        else setTimeout(wait, 100);
      })();
    });
    return youTubeApiPromise;
  }

  async function loadSource(el) {
    const src = el.dataset.src;
    if (src) {
      let res;
      try {
        res = await fetch(src);
      } catch (e) {
        throw new Error(
          `${src} を読み込めませんでした。\n` +
          'HTML ファイルをパソコン上で直接開いている場合は、Web サーバーに置いて開くか、' +
          '<script type="text/plain"> に歌詞を直接書く方式を使ってください。'
        );
      }
      if (!res.ok) throw new Error(`${src} を読み込めませんでした (HTTP ${res.status})`);
      return res.text();
    }
    const inline = el.querySelector('script[type="text/plain"]');
    if (inline) return inline.textContent;
    throw new Error(
      '歌詞データが見つかりません。data-src 属性でファイルを指定するか、' +
      '<script type="text/plain"> の中に歌詞を書いてください。'
    );
  }

  class ClrcPlayer {
    constructor(el) {
      this.el = el;
      this.player = null;
      this.items = [];
      this.focused = null;
      this.needsScroll = false;
      this.userScrolling = false;
      this.scrollTimer = null;
    }

    async init() {
      const source = await loadSource(this.el);
      const parsed = CLRC.parse(source);
      const { lines, warnings } = parsed;
      // ページ側の指定 (data-video-id) があれば、clrc ファイルの [yt:] より優先する
      const videoId = extractVideoId(this.el.dataset.videoId) || parsed.videoId;

      warnings.forEach((w) => console.warn(`[clrc] ${w.line}行目: ${w.message}`));

      this.el.textContent = '';
      const video = document.createElement('div');
      video.className = 'clrc-video';
      const playerHost = document.createElement('div');
      video.appendChild(playerHost);
      this.lyricsBox = document.createElement('div');
      this.lyricsBox.className = 'clrc-lyrics';
      this.el.append(video, this.lyricsBox);

      this.renderLines(lines);
      if (this.el.dataset.debug === 'true' && warnings.length > 0) {
        this.showMessage(warnings.map((w) => `${w.line}行目: ${w.message}`).join('\n'));
      }
      this.bindUserScroll();

      if (!videoId) {
        throw new Error('YouTube の動画 ID が指定されていません。data-video-id 属性か、clrc ファイルの [yt:動画ID] タグで指定してください。');
      }

      const YT = await loadYouTubeAPI();
      this.player = new YT.Player(playerHost, {
        videoId,
        playerVars: { playsinline: 1, rel: 0 },
      });
      requestAnimationFrame(() => this.tick());
    }

    renderLines(lines) {
      this.items = lines.map((line) => {
        const lineEl = document.createElement('div');
        lineEl.className = line.info ? 'clrc-line clrc-info' : 'clrc-line';
        lineEl.addEventListener('click', () => this.seek(line.start));

        if (line.label) {
          const labelEl = document.createElement('span');
          labelEl.className = 'clrc-part';
          labelEl.textContent = line.label;
          labelEl.style.backgroundColor = line.color;
          lineEl.appendChild(labelEl);
        }

        const textWrap = document.createElement('span');
        if (line.info) {
          // 付加情報の行は塗りつぶし・強調表示をしない
          const infoEl = document.createElement('span');
          infoEl.className = 'clrc-info-text';
          infoEl.textContent = line.segments.map((seg) => seg.text).join('');
          infoEl.style.color = line.color;
          textWrap.appendChild(infoEl);
          lineEl.appendChild(textWrap);
          this.lyricsBox.appendChild(lineEl);
          return { line, lineEl, segEls: [], progress: [], active: false };
        }

        const segEls = line.segments.map((seg) => {
          const segEl = document.createElement('span');
          segEl.className = 'clrc-seg';
          segEl.textContent = seg.text;
          segEl.style.setProperty('--active-color', line.color);
          segEl.style.setProperty('--default-color', line.offcolor);
          textWrap.appendChild(segEl);
          return segEl;
        });
        lineEl.appendChild(textWrap);
        this.lyricsBox.appendChild(lineEl);

        return { line, lineEl, segEls, progress: segEls.map(() => 0), active: false };
      });
    }

    showMessage(message) {
      const el = document.createElement('div');
      el.className = 'clrc-message';
      el.textContent = message;
      (this.lyricsBox || this.el).appendChild(el);
    }

    seek(time) {
      if (!this.player || typeof this.player.seekTo !== 'function') return;
      this.player.seekTo(Math.max(0, time), true);
      this.player.playVideo();
    }

    bindUserScroll() {
      const onUserScroll = () => {
        this.userScrolling = true;
        clearTimeout(this.scrollTimer);
        this.scrollTimer = setTimeout(() => {
          this.userScrolling = false;
          this.needsScroll = true;
        }, USER_SCROLL_PAUSE_MS);
      };
      this.lyricsBox.addEventListener('wheel', onUserScroll, { passive: true });
      this.lyricsBox.addEventListener('touchmove', onUserScroll, { passive: true });
    }

    tick() {
      if (this.player && typeof this.player.getCurrentTime === 'function') {
        this.update(this.player.getCurrentTime());
      }
      requestAnimationFrame(() => this.tick());
    }

    update(time) {
      let focused = null;

      this.items.forEach((item) => {
        const { line } = item;
        if (line.info) return;
        const active = time >= line.start && time < line.end;
        if (active !== item.active) {
          item.lineEl.classList.toggle('active', active);
          item.active = active;
        }
        // 開始時間順に並んでいるので、最後に見つかった行が一番新しい行
        if (active) focused = item;

        line.segments.forEach((seg, i) => {
          let progress = 0;
          if (active) {
            if (!line.wipe || time >= seg.end) progress = 100;
            else if (time > seg.start) progress = ((time - seg.start) / (seg.end - seg.start)) * 100;
          }
          if (progress !== item.progress[i]) {
            item.segEls[i].style.setProperty('--progress', `${progress}%`);
            item.progress[i] = progress;
          }
        });
      });

      if (focused !== this.focused) {
        this.focused = focused;
        this.needsScroll = true;
      }
      if (this.needsScroll && this.focused && !this.userScrolling) {
        const el = this.focused.lineEl;
        const top = el.offsetTop + el.clientHeight / 2 - this.lyricsBox.clientHeight / 2;
        this.lyricsBox.scrollTo({ top, behavior: 'smooth' });
        this.needsScroll = false;
      }
    }
  }

  function initPlayers() {
    injectStyle();
    document.querySelectorAll('.clrc-player').forEach((el) => {
      if (el.clrcPlayer) return;
      const player = new ClrcPlayer(el);
      el.clrcPlayer = player;
      if (typeof CLRC === 'undefined' || typeof CLRC.parse !== 'function') {
        player.showMessage('clrc-parser.js が読み込まれていません。clrc-player.js より前に読み込んでください。');
        return;
      }
      player.init().catch((err) => {
        console.error('[clrc]', err);
        player.showMessage(err.message);
      });
    });
  }

  window.CLRC = Object.assign(window.CLRC || {}, { initPlayers });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPlayers);
  } else {
    initPlayers();
  }
})();
