# drive-viewer 設計書

最終更新：2026-11-15　／　関連：[SPEC.md](SPEC.md)・[adr/](adr/)

## 1. 全体構成

```
iPhone PWA（GitHub Pages: tynswk.github.io/drive-viewer/, リポジトリの docs/）
  ├─ Drive API v3 を直接呼ぶ（fetch + Authorization ヘッダ）
  ├─ Service Worker（docs/sw.js）
  │    └─ /stream/{fileId} を alt=media に中継（Range 対応）
  └─ トークンの交換と更新だけ Cloudflare Worker に任せる
        https://drive-viewer-auth.tynswk.workers.dev
          POST /exchange {code, code_verifier, redirect_uri}
          POST /refresh  {refresh_token}
```

| 置き場所 | 中身 |
|---|---|
| `docs/` | 公開するアプリ本体（Pages の配信元） |
| `docs/mock/` | 画面設計のモック（ダミーデータ） |
| `worker/` | トークン中継の Worker（wrangler） |
| `design/` | 仕様書・設計書・ADR（公開しない側） |
| `serve.py` | ローカル確認用サーバー（.js を text/javascript で返す） |

## 2. 認証（→ ADR-0002）

- OAuth 2.0 の認可コードフロー＋PKCE を使う。スコープは `https://www.googleapis.com/auth/drive` で、`access_type=offline`・`prompt=consent` を付ける。
- リダイレクト先はアプリ自身（`https://tynswk.github.io/drive-viewer/` と `http://localhost:5173/`）。受け取った code を Worker の `/exchange` に送り、refresh_token を得る。
- refresh_token は端末の localStorage に置く。access_token の期限が切れる60秒前になったら `/refresh` で取り直す。
- Worker が受け付けるのは、許可した Origin とリダイレクトURIだけ。返すのは access_token・expires_in・refresh_token・scope・error だけで、id_token は返さない。
- GCP：プロジェクト CalenderShare（同意画面は本番環境）、OAuthクライアント「drive-viewer」（ウェブ）。client_id は公開してよい値、client_secret は Worker の secret にだけ置く。

## 3. データ取得

- 最近：`files.list`、`q = trashed=false and mimeType != folder`、`orderBy = modifiedTime desc`。範囲を絞るには親フォルダの解決が要るので、フォルダIDとパスの対応をメモリとIndexedDBにキャッシュする。
- 除外：`.git`・`node_modules`・`__pycache__` の配下。祖先にこれらの名前を持つものを捨てる（親IDから名前を引き、キャッシュする）。（→ ADR-0011）
- ツリー：`files.list` に `'{folderId}' in parents` を付けて、開いたときに1階層ずつ取る。
- パスのディープリンク：ルートから名前で1段ずつ解決し、結果をキャッシュする。
- 更新の追従：開いているファイルの `modifiedTime` を、画面が見えている間だけ15秒ごとに確かめる（Page Visibility）。一覧の新着も同じ周期で見る。

## 4. メディア再生（→ ADR-0004）

- `<video>`・`<audio>` の src は `stream/{fileId}`。Service Worker がこれを受けて、`files.get?alt=media` に Range 付きで中継する。
- Google の応答は CORS の制限で `Content-Range` をページ側に見せない。そこで `files.get?fields=size,mimeType` でサイズを取り、Content-Range・Content-Length・Accept-Ranges を SW で組み立てて返す。
- SW がトークンを読むために、ページは access_token を Cache API（`auth` キャッシュの `__token`）にも書いておく。
- 速度は `playbackRate` で変える。PiP と全画面は OS 標準のものを使う。ロック画面には Media Session API でタイトルを出す。

## 5. 画面構造（→ ADR-0008, ADR-0009, ADR-0010）

```
body
├─ main            … タブの中身（最近／フォルダ）。ページ遷移はしない
├─ nav.tabs        … 下部の2タブ
├─ section.sheet   … ファイルを開いたもの（最大1枚）。z=10
├─ section.sheet.media(.mini) … メディア（全画面 ⇄ ミニバー）。z=20
├─ [popover] 範囲メニュー・その他メニュー
├─ .toast          … 1つだけ
├─ dialog#conflict … 保存時の衝突。全画面の差分とマージ（→ ADR-0014）
└─ dialog#discard  … 変更を破棄して抜けるときの確認（→ ADR-0013）
```

### 5.1 シートの開閉
- 開く：タップした行の矩形を `clip-path: inset(... round 12px)` の始点にして、`inset(0)` まで広げる（Web Animations、--t=150ms、--out のイーズアウト）。中身は同じ時間でフェードインする。
- 閉じる：元の行がまだ画面内にあればその矩形へ縮める。無ければ中央へ縮める。
- 履歴：開くたびに `pushState` する。閉じるボタンも払う操作も `history.back()` に寄せ、`popstate` の1か所で閉じる。これで OS の「戻る」と同じ経路になる。
- 下へ払う：ヘッダ（`data-grab`）だけでポインタを追う。90px超か0.5px/ms超で閉じ、届かなければ元に戻す。本文のスクロールはネイティブに任せる。

### 5.2 メディアのミニバー
- `<video>`・`<audio>` 要素は DOM の中で動かさない（動かすと再生が止まる恐れがある）。同じ `section.sheet.media` に `.mini` を付け、CSS で下部のバーの形に切り替える。
- 収める：全画面の `clip-path` をミニバーの矩形まで縮め、終わったら `.mini` を付ける。戻す：`.mini` を外し、バーの矩形から `inset(0)` まで広げる。
- ミニバーの位置は、タブバーの上（シートが開いていなければ）か画面の下端（開いていれば）。

### 5.3 ツリー
- `li.node.dir > button.row + div.kids > ul`。開閉は `grid-template-rows: 0fr ⇄ 1fr` の遷移で、iOS Safari でも高さが動く。
- 子は最初に開いたときに作る（遅延）。開いているフォルダのキーは `openDirs` に保つ。

## 6. デザイントークン

| トークン | ライト | ダーク | 用途 |
|---|---|---|---|
| --paper | #ffffff | #000000 | 地（ダークは完全な黒。→ ADR-0012） |
| --paper-2 | #f3f4f6 | #16171a | 押下・コード地・ミニバー |
| --ink | #1f2328 | #ececee | 本文 |
| --ink-2 | #646b75 | #93979f | 補助 |
| --line | #e4e6ea | #232428 | 区切り |
| --fresh | #b8760f | #e3a23f | 鮮度・再生中（唯一のアクセント） |
| --t / --t-fast | 150ms / 110ms | | 動きの長さ（視差効果を減らす設定なら0） |
| --out | cubic-bezier(.22,1,.36,1) | | イーズアウト |

- 書体はシステムフォント（-apple-system、ヒラギノ）。生表示と編集は ui-monospace。
- アイコンは lucide の SVG を symbol で inline にする。

## 7. 実装の段階

| 段階 | 内容 | 状態 |
|---|---|---|
| P0 | ログイン・最近の一覧・SW経由のストリーミング | 完了（2026-11-15、iPhone実機で確認済み） |
| モック | 画面設計（docs/mock/） | 第2版（ツリー・起点から覆うシート・ミニバー） |
| P1 | 本実装：最近／ツリー／シート／md・テキスト・HTML・PDF・画像・メディア／編集と競合検知／除外 | 未着手 |
| P2 | ピン留めの編集、検索、パスでのディープリンク、更新の追従、オフラインキャッシュ | 未着手 |

## 8. 衝突時のマージ（→ ADR-0014）

- 編集に入るとき、本文（_editBase）とDriveの版（_editV）を覚える。保存時に版が変わっていれば、最新の本文（theirs）を取り直して `diff3(base, mine, theirs)` にかける。
- `lcsMatch(a, b)` は行単位のLCSで、a の各行に対応する b の添字を返す。`diff3` は、base–mine と base–theirs の両方で対応する base の行を錨にして、間の区間を `same / theirs / mine / both / conflict` に分ける。
- 画面は塊の並びをそのまま描く。conflict の塊だけ `pick`（theirs / mine / both）を持ち、既定は both。`mergedText()` が塊を連結して保存用の本文を作る。
- 色：相手の変更＝`--fresh`（琥珀）の帯、自分の変更＝`--mine`（青）の帯、削除＝打ち消し線。

