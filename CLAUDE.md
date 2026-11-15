# drive-viewer 作業メモ（エージェント向け）

スマホでGoogleドライブのファイルを見るPWA。仕様は `design/SPEC.md`、作りは `design/DESIGN.md`、判断の記録は `design/adr/`。

## 作業の進め方
- 作業を始める前に SPEC.md・DESIGN.md・adr/README.md を読む。
- 判断を1つ下したら、その場で `design/adr/NNNN.md` を1件足し、adr/README.md の表に1行足す。書き方は ADR-0000。
- 仕様が変わったら SPEC.md、作りが変わったら DESIGN.md を、同じコミットで直す。冒頭の「最終更新」の日付も更新する。
- 公開リポジトリなので、書いてよいのは client_id・URL・GCPのプロジェクト名まで。メールアドレス・secret・個人の予定やファイル名の実例は書かない。

## 確認のしかた
- ローカル：`python serve.py docs` → http://localhost:5173/（Google のリダイレクトURIに登録済み）。モックは /mock/。
- 公開：`docs/` を main に push すると https://tynswk.github.io/drive-viewer/ に出る。
- Worker：`cd worker && npx wrangler@4 deploy`。secret は `wrangler secret put GOOGLE_CLIENT_SECRET` で、値はクリップボードから渡す。
