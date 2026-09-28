#!/usr/bin/env node
/*
 * src/clrc-parser.js と src/clrc-player.js を <script> に埋め込んだ HTML を生成する。
 * .js ファイルを置けない環境 (はてなブログなど) 向け。
 *
 *   node tools/build-embed.js
 *
 * 生成物:
 *   src/clrc-embed.html        … スクリプトだけを埋め込んだ HTML
 *   sample/01-hateblo-a.html   … はてなブログ埋め込み用のサンプル
 * あわせて sample/sample.html 内の歌詞 (<script type="text/plain"> の中身) を sample/sample.clrc の内容に更新する。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const write = (file, content) => {
  fs.writeFileSync(path.join(root, file), content);
  console.log(`generated: ${file}`);
};

// インラインの <script> 内に "</script" があるとそこでタグが閉じてしまう
const inlineScript = (file) =>
  `<script>\n${read(file).replace(/<\/script/gi, '<\\/script').trimEnd()}\n</script>`;

const GENERATED_NOTE = 'このファイルは tools/build-embed.js で自動生成しています。直接編集しないでください。';

const scripts = [inlineScript('src/clrc-parser.js'), inlineScript('src/clrc-player.js')].join('\n');

write('src/clrc-embed.html', `<!--
  CLRC プレイヤー (スクリプト埋め込み版)
  ${GENERATED_NOTE}

  .js ファイルを置けないブログなどで使うためのものです。
  このファイルの中身を、歌詞プレイヤーを置くページに 1 回だけ貼り付けてください。
  そのうえで、プレイヤーを置きたい場所に次のように書きます。

    <div class="clrc-player" data-video-id="YouTubeの動画ID">
    <script type="text/plain">
    (ここに clrc ファイルの中身を貼り付ける)
    </script>
    </div>

  clrc ファイルに [yt:動画ID] を書いている場合、data-video-id は省略できます。
  clrc ファイルの書き方は spec.md を参照してください。
-->
${scripts}
`);

const clrc = read('sample/sample.clrc').trim();
if (/<\/script/i.test(clrc)) throw new Error('sample/sample.clrc に "</script" が含まれているため埋め込めません');

write('sample/01-hateblo-a.html', `<!--
  はてなブログ埋め込みサンプル A (1 記事にすべてを貼り付ける方式)
  ${GENERATED_NOTE}

  ■ 使い方
    1. 記事の編集画面で「HTML編集」タブを開く
       (「見たまま」「Markdown」「はてな記法」モードでは、[ ] などが記法として変換されることがあります)
    2. このファイルの中身をすべて貼り付ける
    3. data-video-id を YouTube の動画ID (または動画のURL) に書き換える
       (clrc ファイルに [yt:動画ID] を書いている場合は、data-video-id を消しても構いません)
    4. <script type="text/plain"> ～ </script> の間を、自分の clrc ファイルの中身に書き換える

  ■ 注意
    ・はてなブログには .clrc ファイルを置けないため、data-src は使えません。
      歌詞は必ず <script type="text/plain"> の中に直接書いてください。
    ・歌詞の中に「</script」という文字列は書けません。
    ・1 つの記事に複数のプレイヤーを置く場合は、<div class="clrc-player"> ～ </div> を必要な数だけ並べます。
      一番下の 2 つの <script> ～ </script> は、記事に 1 回だけ書けば十分です。
    ・書き間違いを確認したいときは、<div> に data-debug="true" を付けると警告が表示されます。
-->
<p>コールはNANA CALL BOOK 2022 p16より<br>口上は水樹奈々コールwikiのコメントより https://w.atwiki.jp/nm_7/pages/36.html<br>※独断で勝手に混ぜています</p>

<div class="clrc-player" data-video-id="PPSNnYSKkYs">
<script type="text/plain">
${clrc}
</script>
</div>

${scripts}
`);

const sampleHtml = read('sample/sample.html');
const inlineRe = /(<script type="text\/plain">\n)[\s\S]*?(\n<\/script>)/;
if (!inlineRe.test(sampleHtml)) throw new Error('sample/sample.html に <script type="text/plain"> が見つかりません');
write('sample/sample.html', sampleHtml.replace(inlineRe, (_, open, close) => open + clrc + close));
