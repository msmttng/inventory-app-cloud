# デプロイ手順 — 薬の在庫・棚番検索アプリ

## ⚠️ 重要：本番デプロイメントID

本番で使用しているWebアプリURLは以下の通りです。**デプロイ時は必ずこのIDを指定してください。**

```
デプロイID: AKfycbxRmB7n67cNfGBfQaXXLwK3_QXIupiF-90c6AZsWa4IhaPspf4DkvXw-mTS2kVb1AL_jw
URL: https://script.google.com/macros/s/AKfycbxRmB7n67cNfGBfQaXXLwK3_QXIupiF-90c6AZsWa4IhaPspf4DkvXw-mTS2kVb1AL_jw/exec
```

## 1. GAS（バックエンド）へのデプロイコマンド

```bash
# 1. ファイルをGASにプッシュ
npx clasp push --force

# 2. 本番デプロイメントを更新（必ず -i で本番IDを指定すること！）
npx clasp deploy -i AKfycbxRmB7n67cNfGBfQaXXLwK3_QXIupiF-90c6AZsWa4IhaPspf4DkvXw-mTS2kVb1AL_jw -d "変更内容の説明"
```

> **注意**: `-i` を省略すると新しいデプロイメントが作られ、本番URLに反映されません。

---

## 2. GitHub Pages（クラウド / フロントエンド）への反映手順

**⚠️ 警告: `inventory_app` フォルダ内のコード（特に `index.html` デザイン）を更新した場合は、必ず以下の手順を実行してクラウド（GitHub Pages）側へ Push を行ってください。**

GitHub Pages は `inventory_app/docs` ディレクトリの内容をホスティングしています。GAS への反映だけでは GitHub Pages ( https://msmttng.github.io/inventory-app-cloud/ ) は更新されません。

```bash
# 1. フロントエンドビルド用フォルダへ移動
cd ../inventory-frontend

# 2. 最新のGAS版index.htmlにプロキシ設定を注入（docsへ反映する準備）
python build_frontend.py

# 3. Tailwind CSS のビルド
npx @tailwindcss/cli -i input.css -o output.css

# 4. 生成物を docs ディレクトリへコピー
Copy-Item index.html, output.css -Destination "..\inventory_app\docs\" -Force

# 5. inventory_app フォルダに戻り Git へ Push
cd ../inventory_app
git add .
git commit -m "Update frontend UI and push to cloud"
git push origin main
```

GitへのPush後、数分でGitHub Actionsが走り、GitHub Pages の内容が自動的に更新されます。

## その他のデプロイメント（参考）

| 用途 | デプロイID |
|------|-----------|
| **本番（上記）** | `AKfycbxRm...1AL_jw` |
| PharmaScan Pro用 | `AKfycbwPmjajDh2A...vaxw` |
