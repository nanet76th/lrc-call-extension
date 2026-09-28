# lrc-call-extension (CLRC)

YouTube 動画の再生に同期して、歌詞・コール・口上を表示するためのツールです。

一般的な LRC 形式（歌詞に再生時間を付けたテキスト形式）を拡張した独自フォーマット **CLRC** と、それを解釈してブラウザ上に表示するプレイヤーで構成されています。

- コール（`ハイ!` `Fuu!` など）や口上をパートごとに色分けして表示
- 単語・文字単位の塗りつぶし演出（カラオケ風）
- ブログなど `.js` ファイルを置けない環境向けに、スクリプトを埋め込んだ HTML を生成するビルドツール

## 構成

| パス | 内容 |
| --- | --- |
| `spec.md` | CLRC ファイル形式の仕様 |
| `src/clrc-parser.js` | CLRC ファイルのパーサー |
| `src/clrc-player.js` | YouTube 動画との同期表示を行うプレイヤー本体 |
| `src/clrc-embed.html` | 上記 2 つを `<script>` に埋め込んだ生成物（`tools/build-embed.js` で自動生成） |
| `tools/build-embed.js` | 埋め込み用 HTML・サンプルを生成するビルドスクリプト |
| `sample/` | 動作サンプル一式 |

## 使い方

必要なのは「YouTube の動画 ID」と「CLRC ファイルの中身」だけです。

```html
<div class="clrc-player" data-video-id="YouTubeの動画ID">
<script type="text/plain">
(ここに CLRC ファイルの中身を貼り付ける)
</script>
</div>

<script src="src/clrc-parser.js"></script>
<script src="src/clrc-player.js"></script>
```

CLRC ファイルをサーバー上に置ける場合は、`<script type="text/plain">` の代わりに `data-src="ファイル名.clrc"` で外部ファイルを指定することもできます（ローカルで HTML を直接開いた場合はブラウザの制約により動作しません）。

CLRC ファイルに `[yt:動画ID]` タグを書いている場合、`data-video-id` は省略できます。両方ある場合は `data-video-id` が優先されます。

書き間違いを確認したい場合は `data-debug="true"` を指定すると、パーサーの警告が表示欄の下に表示されます。

具体的な例は [sample/sample.html](sample/sample.html) を参照してください。

CLRC ファイルの書き方（パート定義・メタデータタグ・歌詞行の書式など）は [spec.md](spec.md) を参照してください。

### はてなブログなど `.js` ファイルを置けない環境で使う場合

`.js` ファイルを配置できないブログサービスでは、`sample/01-hateblo-a.html` のようにスクリプトを本文に直接埋め込む形式を使います。

```sh
node tools/build-embed.js
```

を実行すると、`src/clrc-embed.html` と `sample/01-hateblo-a.html`（および `sample/sample.html` 内の歌詞部分）が再生成されます。`src/clrc-parser.js` / `src/clrc-player.js` を変更した場合は、このコマンドで埋め込み版を更新してください。

## ライセンス

[MIT License](LICENSE)

## 免責事項

歌詞の著作権は、その権利者に帰属します。本ツールに読み込ませる CLRC ファイルの内容について、著作権上の扱いは利用者ご自身の責任で確認・判断してください。
