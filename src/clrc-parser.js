/*!
 * clrc-parser.js
 * CLRC (.clrc) ファイルのパーサー。ファイル仕様は spec.md (v0.7 Draft) を参照。
 *
 * 使い方:
 *   const result = CLRC.parse(text);
 *   // result.meta     : メタデータタグ ([ti:] [ar:] [offset:] [yt:] など)
 *   // result.version  : 準拠している CLRC 規格のバージョン ([v:] タグ。無ければ "0.6")
 *   // result.videoId  : [yt:] タグの YouTube 動画 ID (無ければ null)
 *   // result.parts    : パート定義 { ラベル名: { label, color, offcolor, scroll, holdsec } }
 *   // result.lines    : 表示する歌詞行 (開始時間順)。"#:" の付加情報の行は info: true
 *   // result.warnings : 仕様違反・解釈できなかった行 { line: 行番号, message }
 *
 * ブラウザでは window.CLRC.parse、Node.js では require('./clrc-parser').parse で使える。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.CLRC = Object.assign(root.CLRC || {}, api);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // mm:ss.xx (パーサーは ss / ss.x / ss.xxx も受け付ける)
  const TIME = '(\\d+):(\\d{1,2}(?:\\.\\d{1,3})?)';
  const LINE_TIME_RE = new RegExp('^\\[' + TIME + '\\](.*)$');
  const END_TIME_RE = new RegExp('\\[' + TIME + '\\]$');
  const WORD_TIME_RE = new RegExp('<' + TIME + '>', 'g');
  const PART_DEF_RE = /^\[pt:([^:\]]*):(.*)\]$/;
  const META_TAG_RE = /^\[([A-Za-z]+):(.*)\]$/;
  const LABEL_RE = /^([A-Z][A-Z0-9]*|#):/;
  const PART_NAME_RE = /^[A-Z][A-Z0-9]*$/;
  const EXTRA_LINE_TIME_RE = new RegExp('^\\[' + TIME + '\\]');
  const VERSION_RE = /^\d+\.\d+$/;
  // 動画 ID の長さは YouTube の公式仕様で保証されていないため、文字の種類だけを確認する
  const VIDEO_ID_RE = /^[\w-]+$/;

  // [v:] タグが無いファイルは初版として扱う
  const INITIAL_VERSION = '0.6';

  const DEFAULT_PART_NAME = 'default';
  const BUILTIN_DEFAULT_PART = { label: null, color: '#ffffff', offcolor: '#777777', scroll: true, holdsec: 0 };
  // "#:" は曲中の付加情報 (イントロ、1番、間奏など)。塗りつぶし・強調表示をしない
  const INFO_PART_NAME = '#';
  const BUILTIN_INFO_PART = { label: null, color: '#999999' };
  const INFO_PART_KEYS = ['label', 'color'];

  const toSeconds = (min, sec) => parseInt(min, 10) * 60 + parseFloat(sec);

  function parsePartProps(propsText, lineNo, warn) {
    const props = {};
    propsText.split('|').forEach((pair) => {
      if (pair.trim() === '') return;
      const eq = pair.indexOf('=');
      if (eq < 0) {
        warn(lineNo, `パート定義の "${pair.trim()}" は "キー=値" の形式ではありません`);
        return;
      }
      const key = pair.slice(0, eq).trim().toLowerCase();
      const value = pair.slice(eq + 1).trim();
      switch (key) {
        case 'label':
          props.label = value;
          break;
        case 'color':
          props.color = value;
          break;
        case 'offcolor':
          props.offcolor = value;
          break;
        case 'scroll':
          if (value === 'true' || value === 'false') props.scroll = value === 'true';
          else warn(lineNo, `scroll には true か false を指定してください (指定値: "${value}")`);
          break;
        case 'holdsec': {
          const sec = Number(value);
          if (value !== '' && Number.isFinite(sec) && sec >= 0) props.holdsec = sec;
          else warn(lineNo, `holdsec には0以上の秒数を指定してください (指定値: "${value}")`);
          break;
        }
        default:
          warn(lineNo, `パート定義のキー "${key}" は未対応のため無視します`);
      }
    });
    return props;
  }

  // 本文を <mm:ss.xx> で区切り、塗りつぶし用のセグメントに分ける
  function parseBody(body, lineStart, displayEnd, lineNo, warn) {
    const segments = [];
    let hasWordTime = false;
    let segStart = lineStart;
    let text = '';
    let cursor = 0;
    let match;

    WORD_TIME_RE.lastIndex = 0;
    while ((match = WORD_TIME_RE.exec(body)) !== null) {
      text += body.slice(cursor, match.index);
      cursor = match.index + match[0].length;
      const time = toSeconds(match[1], match[2]);
      hasWordTime = true;
      if (time < segStart) {
        warn(lineNo, `<${match[1]}:${match[2]}> が直前の時間より前になっています`);
      }
      if (text !== '') {
        segments.push({ text, start: segStart, end: time });
        text = '';
      }
      segStart = time;
    }
    text += body.slice(cursor);

    if (text !== '') {
      if (!hasWordTime) {
        // <> が無い行: 表示終了時間があれば行全体を1つとして塗りつぶす
        segments.push({ text, start: lineStart, end: displayEnd !== null ? displayEnd : lineStart });
      } else if (displayEnd !== null) {
        segments.push({ text, start: segStart, end: displayEnd });
      } else {
        warn(lineNo, '<mm:ss.xx> を使う行は、行末に <mm:ss.xx> か [mm:ss.xx] が必要です');
        segments.push({ text, start: segStart, end: segStart });
      }
    }

    return { segments, hasWordTime };
  }

  function parse(source) {
    const meta = {};
    const parts = {};
    const rawLines = [];
    const warnings = [];
    const warn = (line, message) => warnings.push({ line, message });

    String(source).replace(/^﻿/, '').split(/\r\n|\r|\n/).forEach((original, i) => {
      const lineNo = i + 1;
      const line = original.trim();
      if (line === '' || line.startsWith('#')) return;

      const partDef = line.match(PART_DEF_RE);
      if (partDef) {
        const name = partDef[1].trim();
        if (name !== DEFAULT_PART_NAME && name !== INFO_PART_NAME && !PART_NAME_RE.test(name)) {
          warn(lineNo, `パート名 "${name}" は使えません (先頭は半角英大文字、2文字目以降は半角英大文字か数字。または default、#)`);
          return;
        }
        if (parts[name]) warn(lineNo, `パート "${name}" が再定義されています (後の定義を使います)`);
        const props = parsePartProps(partDef[2], lineNo, warn);
        if (name === INFO_PART_NAME) {
          Object.keys(props).filter((key) => !INFO_PART_KEYS.includes(key)).forEach((key) => {
            warn(lineNo, `パート "#" では ${key} は使えないため無視します (使えるのは label と color のみ)`);
            delete props[key];
          });
        }
        parts[name] = props;
        return;
      }

      const timed = line.match(LINE_TIME_RE);
      if (timed) {
        const start = toSeconds(timed[1], timed[2]);
        let body = timed[3];
        let part = null;
        let displayEnd = null;

        if (EXTRA_LINE_TIME_RE.test(body)) {
          warn(lineNo, '1行に複数の行タイムスタンプは書けないため無視します (タイムスタンプごとに行を分けてください)');
          return;
        }
        const label = body.match(LABEL_RE);
        if (label) {
          part = label[1];
          body = body.slice(label[0].length);
        }
        if (part === INFO_PART_NAME) {
          WORD_TIME_RE.lastIndex = 0;
          if (WORD_TIME_RE.test(body) || END_TIME_RE.test(body)) {
            warn(lineNo, '"#:" の行では <mm:ss.xx> と表示終了時間は使えないため無視します');
          }
          const text = body.replace(WORD_TIME_RE, '').replace(END_TIME_RE, '');
          if (text === '') {
            warn(lineNo, '本文が空の歌詞行は使えないため無視します');
            return;
          }
          rawLines.push({ lineNo, part, start, displayEnd: null, segments: [{ text, start, end: start }], info: true });
          return;
        }
        const end = body.match(END_TIME_RE);
        if (end) {
          displayEnd = toSeconds(end[1], end[2]);
          body = body.slice(0, end.index);
          if (displayEnd <= start) warn(lineNo, '表示終了時間が表示開始時間以前になっています');
        }

        const { segments, hasWordTime } = parseBody(body, start, displayEnd, lineNo, warn);
        if (segments.length === 0) {
          warn(lineNo, '本文が空の歌詞行は使えないため無視します (表示を終えるには行末に [mm:ss.xx] を書いてください)');
          return;
        }
        rawLines.push({ lineNo, part, start, displayEnd, segments, hasWordTime });
        return;
      }

      const tag = line.match(META_TAG_RE);
      if (tag) {
        const key = tag[1].toLowerCase();
        const value = tag[2].trim();
        if (key === 'offset') {
          const ms = Number(value);
          if (value !== '' && Number.isFinite(ms)) meta.offset = ms;
          else warn(lineNo, `offset にはミリ秒の数値を指定してください (指定値: "${value}")`);
        } else if (key === 'v') {
          if (VERSION_RE.test(value)) meta.v = value;
          else warn(lineNo, `v には "0.7" のような 数字.数字 の形式でバージョンを指定してください (指定値: "${value}")`);
        } else if (key === 'yt') {
          if (VIDEO_ID_RE.test(value)) meta.yt = value;
          else warn(lineNo, `yt には YouTube の動画 ID (半角英数字と - _ のみ) を指定してください。URL ではなく ID だけを書きます (指定値: "${value}")`);
        } else {
          meta[key] = value;
        }
        return;
      }

      warn(lineNo, '解釈できない行のため無視します');
    });

    // [offset:+500] は歌詞を 0.5 秒早く表示する (一般的なLRCと同じ)
    const shift = (meta.offset || 0) / 1000;
    if (shift !== 0) {
      rawLines.forEach((l) => {
        l.start -= shift;
        if (l.displayEnd !== null) l.displayEnd -= shift;
        l.segments.forEach((s) => { s.start -= shift; s.end -= shift; });
      });
    }

    // Array.prototype.sort は安定ソートなので、同時刻の行はファイル内の順序を保つ
    rawLines.sort((a, b) => a.start - b.start);

    const partKey = (l) => (l.part === null ? DEFAULT_PART_NAME : l.part);
    const defaultPart = Object.assign({}, BUILTIN_DEFAULT_PART, parts[DEFAULT_PART_NAME]);
    const warnedParts = new Set();

    const infoPart = Object.assign({}, BUILTIN_INFO_PART, parts[INFO_PART_NAME]);

    const lines = [];
    rawLines.forEach((l, index) => {
      if (l.info) {
        lines.push({
          lineNo: l.lineNo,
          part: INFO_PART_NAME,
          info: true,
          label: infoPart.label || null,
          color: infoPart.color,
          offcolor: infoPart.color,
          wipe: false,
          start: l.start,
          end: l.start,
          segments: l.segments,
        });
        return;
      }
      if (l.part !== null && !parts[l.part] && !warnedParts.has(l.part)) {
        warnedParts.add(l.part);
        warn(l.lineNo, `パート "${l.part}" は定義されていないため default の設定を使います`);
      }
      const config = Object.assign({}, defaultPart, l.part !== null ? parts[l.part] : null);
      const displayLabel = l.part !== null && !(parts[l.part] && parts[l.part].label !== undefined)
        ? l.part
        : config.label;

      let end;
      if (l.displayEnd !== null) {
        end = l.displayEnd + config.holdsec;
      } else {
        // 表示終了時間が無い行は、同じパートで後から始まる行が始まるまで表示する
        const next = rawLines.slice(index + 1).find((n) => partKey(n) === partKey(l) && n.start > l.start);
        end = next ? next.start : Infinity;
      }

      lines.push({
        lineNo: l.lineNo,
        part: partKey(l),
        info: false,
        label: displayLabel || null,
        color: config.color,
        offcolor: config.offcolor,
        wipe: config.scroll && (l.hasWordTime || l.displayEnd !== null),
        start: l.start,
        end,
        segments: l.segments,
      });
    });

    warnings.sort((a, b) => a.line - b.line);
    return {
      meta,
      version: meta.v || INITIAL_VERSION,
      videoId: meta.yt || null,
      parts,
      lines,
      warnings,
    };
  }

  return { parse };
});
