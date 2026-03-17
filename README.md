# Inventory App Cloud Scraper

Google Apps Script (GAS) ベースの在庫管理システムのデータ抽出を、ローカルPCから **GitHub Actions** を用いた完全クラウド環境へ移行するためのリポジトリです。

## 構成
- `.github/workflows/scrape.yml` : 毎日定時にスクレイピングを実行する GitHub Actions 設定
- `extract_data.py` : データ抽出を行うメインスクリプト（Headless環境対応）
- `generate_state.py` : Googleアカウントのログイン状態（Cookie等）をローカルPCで生成するツール
- `requirements.txt` : Pythonライブラリ依存関係

---

## セットアップ手順

完全なクラウド運用を実現するためには、以下の設定が必要です。

### 1. Google アカウントのログイン状態（Cookie）の生成
Looker Studio はロボット検知と二段階認証が厳しいため、一度手元のPCでログインした状態をファイルとして保存し、GitHubにアップロードします。

1. ご自身のPCでコマンドプロンプト（またはPowerShell）を開き、このフォルダに移動します。
2. 以下のコマンドで必要なライブラリをインストールし、スクリプトを実行します。
   ```bash
   pip install playwright
   playwright install chromium
   python generate_state.py
   ```
3. ブラウザが起動するので、通常通り **Looker Studioの表示権限を持つGoogleアカウント** でログインしてください。
4. ログインが完了したら、ターミナルの画面に戻り `Enter` キーを押します。
5. ターミナルに非常に長い **Base64形式の文字列** が出力されます。これをすべてコピーしてください。

### 2. GitHub リポジトリへのアップロード & Secrets 登録
1. GitHub 上に新しいプライベートリポジトリを作成し、このフォルダのファイル一式を Push します。
2. GitHub のリポジトリページから、**Settings** > **Secrets and variables** > **Actions** を開きます。
3. `New repository secret` ボタンを押し、以下の5つのシークレットを登録してください。

| Name | Secret (値) |
|---|---|
| `GOOGLE_AUTH_STATE_BASE64` | **先ほどコピーしたBase64文字列** を貼り付けます |
| `MEDORDER_EMAIL` | MedOrderログイン用のメールアドレス |
| `MEDORDER_PASSWORD` | MedOrderログイン用のパスワード |
| `ORDER_EPI_ID` | Order-EPI ログイン用のID |
| `ORDER_EPI_PASSWORD` | Order-EPI ログイン用のパスワード |

### 3. スケジュール実行の確認
1. GitHub の **Actions** タブを開きます。
2. 左側のリストから `Inventory Data Scraper` を選択します。
3. `Run workflow` ボタンを押し、手動で1回実行してみます。
4. 数分待って、アイコンが緑色のチェックマークになれば成功です。アプリ側にデータが反映されているか確認してください。

これ以降は、`.github/workflows/scrape.yml` で設定された時間（デフォルトは毎日日本時間 午前5時）に自動で実行されます。
