# tech-trend-archiver

xAI の API を利用して、0:00 と 12:00 に IT トレンド情報を取得し Cloudflare D1 に保存する Cloudflare Workers です。
保存された情報はブログ側で日付指定して参照できる形式で格納されます。

## 機能概要

- Cloudflare Cron Triggers で 0:00 / 12:00 に起動
- xAI API に指定プロンプトで問い合わせ
- レスポンスはそのまま D1 に保存（整形なし）
- D1 には日付と「0:00 / 12:00」スロットを持つレコードとして保存

## データ構造 (D1)

`schema.sql` を D1 に適用します。

- `trend_entries`
  - `id`: 主キー
  - `date`: `YYYY-MM-DD`（JST）
  - `slot`: 0 (0:00 取得) / 1 (12:00 取得)
  - `raw_response`: xAI のレスポンス全文
  - `fetched_at`: 取得時刻 (UTC ISO8601)

## 環境構築

### 1. 依存ツール

- Node.js 20+
- Cloudflare Wrangler

```bash
npm install -g wrangler
```

### 2. Cloudflare D1 の作成

```bash
wrangler d1 create tech-trend-archiver
```

作成後に表示される `database_id` は控えておきます。

#### Workers の Bindings で D1 を連携

Cloudflare ダッシュボードで対象 Worker を開き、**Settings → Variables** の **D1 database bindings** に以下を追加します。

- **Variable name**: `D1_DB`
- **D1 database**: 作成した `tech-trend-archiver`

### 3. D1 スキーマ適用

```bash
wrangler d1 execute tech-trend-archiver --file=./schema.sql
```

### 4. シークレット登録

Workers に xAI API キーを登録します。

```bash
wrangler secret put XAI_API_KEY
```

### 5. Cron Triggers 設定

Cloudflare ダッシュボードまたは Wrangler で以下を設定します。

- 0:00 と 12:00 で実行
- JST で実行したい場合は UTC に換算して設定

例: JST 0:00/12:00 を UTC に換算した Cron

- 15:00 UTC (前日)
- 03:00 UTC

### 6. ローカル実行

```bash
wrangler dev
```

## Cloudflare Git 連携デプロイ

Cloudflare の Git 連携（Workers & Pages の **Git integration**）でデプロイします。

1. Cloudflare ダッシュボードで **Workers & Pages → Create** を選択
2. リポジトリを接続して **Workers** を選択
3. ビルド設定はデフォルトのまま保存（Wrangler が実行されます）
4. 以降は `main` への push で自動デプロイされます

## ブログ側での利用

ブログ側は D1 の `trend_entries` から `date` を指定して取得します。

```sql
SELECT * FROM trend_entries
WHERE date = '2024-12-01'
ORDER BY slot ASC;
```

## xAI プロンプト

```
ここ12時間のX(旧：Twitter)での、IT技術についての話題を収集して、ホットな話題になっているIT技術情報について、以下のフォーマットで返却してください。
情報の記述形式は、シンプルな「見出し＋簡潔な内容」、での箇条書きでお願いします。

-----

■最新のIT技術トレンド情報
[[ここに収集した情報を入れる]]

■最新のIT脆弱性情報
[[ここに収集した情報を入れる]]
```
