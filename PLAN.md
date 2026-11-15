# drive-viewer 計画

スマホ（iPhone中心、Androidでも動く）で、エージェントが書いたGoogleドライブ上のファイルをすぐ開くためのPWA。

## 0. 既存のもので足りるか

| 手段 | 足りない点 |
|---|---|
| Drive公式アプリ | mdをレンダリングしない・編集できない／HTMLはソース表示しかない／エージェントからファイルへ直接飛ぶリンクを作れない |
| iOSのファイル＋Quick Look | md・HTMLの描画が弱い、編集できない、更新日順の横断一覧がない |

自作で上回れる点は4つ：**mdのレンダリングと編集**、**HTMLを描画して表示**、**フォルダを横断した最終更新順の一覧**、**パスでのディープリンク**（`?path=Claude/dev/x/PLAN.md` のように、エージェントがローカルパスからそのままリンクを作れる）。動画・PDFは標準のプレーヤーやpdf.jsに任せて、表示は自作しない。

## 1. 構成（推奨）

```
iPhone PWA (GitHub Pages, 静的)
  ├─ Drive API v3 を直接呼ぶ（fetch + Authorization ヘッダ）
  ├─ Service Worker：アプリ本体のキャッシュ ＋ 動画/音声のストリーミング中継
  └─ トークン更新だけ Cloudflare Worker（無料・サーバーレス）
        code→refresh_token の交換 / refresh_token→access_token
```

- **PCを経由しない**：PCが落ちていても見られるようにし、常駐も増やさない。
- **ホスティングはGitHub Pages**（live-metronome・calendershareと同じやり方）。
- **認証**：OAuthの認可コードフローを使い、client_secretはWorkerの環境変数にだけ置く。refresh_tokenは端末のIndexedDBに保存する。
  - Google Identity Servicesのトークンクライアントだけで済ませる案もあるが、トークンが1時間で切れ、更新のたびにポップアップが出る。iOSのPWAではポップアップの挙動が不安定で、1時間ごとのログインは使い物にならないので採らない。
  - client_secretを静的サイトに埋め込む案は、公開リポジトリだとシークレットスキャンで無効化される恐れがあるので採らない。
- **GCP**：既存プロジェクト（CalenderShare）に「ウェブアプリ」のOAuthクライアントを新しく作る。スコープは編集のため `drive`。同意画面は既に本番環境（2026-11-15に確認済み）なので、refresh_tokenが7日で切れる問題は無い。個人用途なので、未確認アプリの警告は一度通せば済む。

## 2. 機能

### 一覧
- **最近**（既定のタブ）：Drive全体または指定フォルダ配下を `modifiedTime desc` で並べる。エージェント作業の主な入口。
- **フォルダ**：パンくずでたどる。並び順は更新日／名前の切り替え。
- **ピン留め**：よく使うフォルダ（`Claude`、`dev/xxx` など）。
- 名前検索（`name contains`）。
- 各行は種別アイコン、名前、相対時刻（「3分前」）、親フォルダ名。プルで再読み込み。

### ビューア（MIMEと拡張子で振り分け）
| 種別 | 表示 | 備考 |
|---|---|---|
| md | レンダリング ⇄ 生 の切り替え | marked + DOMPurify、コードハイライト。生モードではtextareaで編集して保存 |
| txt/json/py/log など | 生（等幅） | 簡易編集も同じ仕組みで対応 |
| HTML | ブラウザで開く ⇄ 生 | `iframe sandbox="allow-scripts"`（same-origin無し＝トークンに触れられない）＋ srcdoc |
| PDF | pdf.js | iOS/Androidのiframe表示は1ページ目しか出ない・表示されないので使わない |
| 動画/音声 | `<video controls>` / `<audio controls>` | OS標準のコントロール。PiP・全画面は標準のものを使う |
| 画像 | `<img>` | ピンチズームはOS任せ |
| その他 | 「Driveで開く」リンク | |

### md編集の保存
- 保存前に `files.get(fields=version)` を取り、開いたときのversionと違っていたら上書きせず、「エージェント側で更新されています。再読込／上書き」の確認を出す。エージェントが同時に書き換えている前提なので、これは必須にする。
- 保存は `PATCH upload/drive/v3/files/{id}?uploadType=media`。

### 動画・音声のストリーミング
- `<video src>` にはAuthorizationヘッダを付けられない。そこでService Workerが `/stream/{fileId}` への要求を受け、Rangeヘッダごと `alt=media` に中継し、206をそのまま返す。これでダウンロードを待たずに再生・シークできる。
- 再生速度：Androidは標準メニューにある。iOSは全画面の標準プレーヤーにはあるが、インライン表示と `<audio>` には無い。そこで、`playbackRate` を変える小さなセレクタ（0.75/1/1.25/1.5/1.8/2）を下に1つ置く。PiPはiOS/Androidとも標準ボタンで出る。
- Media Session APIでロック画面にタイトルを出す（音声のバックグラウンド再生向け）。

### ディープリンク
- `?id={fileId}` と `?path=Claude/…` の2種類。pathは親から順に解決し、結果はキャッシュする。
- エージェントやdotsがDiscordに投げる用途を想定している。ただしiOSはリンクを「ホーム画面のPWA」で開かず、Safariのタブで開き、ストレージもPWAとは別になる。このため、Safari側でも一度ログインしておけば動く形にする。

## 3. 先に潰すリスク（実装前のスパイク）

1. **iOSのPWA（ホーム画面から起動）でのOAuthリダイレクト**：Googleのログインから戻ったときにPWA側のストレージにトークンが入るか。
2. **iOS SafariでService Worker経由の動画Range再生**：シークできるか、PiPが出るか。ダメなら小さいファイルはBlobで全部取得する方式に落とす。

この2つが通れば残りは素直な実装になる。iPhone実機で本人に1回ずつ触ってもらう必要がある。

## 4. 段階

| 段階 | 内容 |
|---|---|
| P0 スパイク | GCPクライアント作成、Worker、ログイン＋1本の動画再生だけのページで上の2点を検証 |
| P1 MVP | 最近／フォルダ一覧、md（レンダリング/生/編集/競合検知）、テキスト、画像、動画・音声、PDF、HTML、PWA化（manifest・アイコン・SW） |
| P2 | ピン留め、検索、パスでのディープリンク、最近開いたファイルのオフラインキャッシュ（IndexedDB） |
| P3（必要なら） | HTMLの相対パス素材（同じフォルダのcss/画像）の解決、mdのMermaid/KaTeX |

## 5. 技術スタック
- Vite + TypeScript + Preact（軽く、ビルド後も小さい）
- marked, DOMPurify, highlight.js, pdf.js（pdfjs-dist）
- アイコンはlucide。単色・フラット、説明文は付けない
- 置き場所：`dev/drive-viewer`、公開リポジトリ `tynswk/drive-viewer` → GitHub Pages（client_idは公開しても問題ない値。secretはWorker側にだけ置く）

## 6. 本人にしかできない作業
- Cloudflareアカウント（無ければ作成。wrangler loginをブラウザで1回）
- （済）GCPの同意画面は既に本番環境
- iPhone実機での確認（P0の2点）

## 7. 設定済み（2026-11-15）
- Drive API：CalenderShareプロジェクトで有効化済み
- OAuthクライアント「drive-viewer」（ウェブアプリケーション）
  - client_id: `591925567747-l2hgpfep4qvme7c5tdhh9mnal8nub2h1.apps.googleusercontent.com`
  - JavaScript生成元：`https://tynswk.github.io`、`http://localhost:5173`
  - リダイレクトURI：`https://tynswk.github.io/drive-viewer/`、`http://localhost:5173/`（Pagesで認可コードを受け取り、Workerに渡して交換する）
  - client_secret：作成時のダイアログでしか表示されないので、取得していない。Workerを設定するときにコンソールの「シークレットを追加」で新しく発行し、`wrangler secret put` で直接入れる（チャットやファイルには残さない）
