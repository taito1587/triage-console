# アーキテクチャ図 生成プロンプト集（ChatGPT 画像生成用）

Manufacturing Triage Agent のアーキテクチャ図を、ChatGPT（GPT-4o の画像生成 / DALL·E）で
**ビジネス向けプロ仕様・シンプル・Azure 公式サービスアイコンつき**に生成するためのプロンプト集です。

## 使い方

1. ChatGPT の**新しい会話**を開く。
2. まず **STEP 0（共通スタイル設定）** を 1 回貼る。
3. 続けて **図① / 図② / 図③** のプロンプトを 1 つずつ貼る（同じ会話内なら STEP 0 のスタイルが引き継がれます）。
4. 生成後、「もっと余白を」「文字を減らして」「矢印を細く」などで微調整。

:::message
**ロゴ精度のコツ**：画像生成は Azure 公式アイコンを完璧には描けないことがあります。
- まず本プロンプトで「雰囲気の良いプロ図」を作る → プレゼン/記事用には十分。
- **ピクセル正確な公式アイコン**が必要なら、末尾の「補足：draw.io / Mermaid で正確に作る」を参照。
:::

---

## STEP 0 ── 最初に 1 回だけ貼る（共通スタイル設定）

```
あなたはエンタープライズ向けのクラウドアーキテクチャ図を専門に作るシニア・インフォグラフィック・デザイナーです。
これから Microsoft Azure 上のシステム構成図を複数枚つくります。すべての図で、以下のスタイルを厳守してください。

# ビジュアルスタイル（厳守）
- 体裁：横長 16:9、高解像度、背景は白〜ごく薄いグレー。Microsoft の「Azure Architecture Center」公式リファレンス図のような、フラットでモダンで清潔な企業向けデザイン。
- アイコン：各サービスは Microsoft Azure の公式サービスアイコン（カラーの幾何学アイコン）で表現し、すぐ下にサービスの正式英語名を小さく添える。
- グルーピング：関連コンポーネントは角丸の枠（薄いグレー/ブルーの塗り）でまとめ、枠の上部に日本語の見出しを付ける。
- 配色：ベースは白・ニュートラルグレー。アクセントは Azure ブルー（#0078D4 系）。自律アクション/通知の経路だけアンバー（橙）で強調。色は使いすぎない。
- レイアウト：流れは左→右（または上→下の層）。矢印は細く直線的、要所だけ短い日本語ラベル。整列・等間隔・たっぷりの余白を徹底し、ごちゃつかせない。
- 文字：Segoe UI 風のサンセリフ。ラベルは短く正確に。意味のない文字列やダミーテキストは絶対に入れない。
- 装飾：3D・写真・過剰なドロップシャドウ・グラデーション乱用は禁止。あくまでシンプルで読みやすく。
- 凡例：右下か左下に小さな凡例（実線=同期/API 呼び出し、点線=非同期/フォールバック/同期、橙=自律アクション）。

このスタイルを、これ以降に指定する各構成図すべてに適用してください。準備ができたら「準備OK」とだけ返答してください。
```

---

## 図① ── 今回のアーキテクチャ（ハッカソン MVP）

> ねらい：個人クレジット内で**実際に本番稼働している最小構成**。シンプルさと「動くこと」を見せる。

```
【図①：ハッカソンMVP構成】を1枚の構成図にしてください。スタイルは先ほどの共通設定どおり。

# 含める要素（左→右の流れ）
1. 「現場クライアント」枠：ブラウザ上の Single Page Application（React + TypeScript）。入力手段として「フォーム入力 / 音声入力 / 画像添付」の3つを小さく明記。
2. 「Azure App Service（FastAPI）」枠：フロント配信とREST APIを単一ホストで提供。中に4つの内部コンポーネントを小さく配置：Orchestrator（エンジン切替＋自動フォールバック）／Retrieval（意味検索）／Action Agent（Function Calling）／Evaluation（品質評価）。
3. 「Azure AI Foundry Agent Service」枠：中央に「トリアージ責任者（Orchestrator）」、そこから connected agent として「品質影響スペシャリスト」「保全プランナー」へ枝分かれ。
4. 「Azure OpenAI Service」：GPT-4o（推論・画像解析）、Whisper（音声）、Embeddings（検索）の3用途を小さく併記。
5. 「ローカル RAG ナレッジ」：データアイコンで「手順書 / 過去トラブル / 設備台帳 / 品質記録」。
6. 「Azure Cosmos DB（serverless）」：feedback / incidents の2コンテナ。
7. 「Microsoft Teams」：保全への通知先。

# 矢印（経路）
- SPA → App Service（実線「API」）。
- App Service → Azure OpenAI（実線「推論/vision/文字起こし」）。
- App Service → Azure AI Foundry（実線「engine=foundry」）／同じく App Service 内 Orchestrator へ戻る点線（「失敗時フォールバック」）。
- App Service → ローカルRAGナレッジ（実線「横断検索」）。
- App Service（Action Agent）→ Microsoft Teams（橙の実線「自律エスカレーション」）。
- App Service → Cosmos DB（実線「保存」）／ Cosmos DB → ローカルRAGナレッジ（点線「学習還流：現場確定事例」）。

# 図のタイトル / キャプション
- タイトル：「Manufacturing Triage Agent ― 現行構成（Azure / 本番稼働中）」
- 右上に小さなバッジ：「個人クレジット内・固定費ほぼゼロ」。

要素は増やしすぎず、上記だけ。シンプルで一目で流れが追える図にしてください。
```

---

## 図② ── 本番想定アーキテクチャ（エンタープライズ）

> ねらい：実運用にスケールさせたときの**堅牢性・セキュリティ・取り込み/アクションの自動化**を示す。

```
【図②：本番想定（エンタープライズ）構成】を1枚の構成図にしてください。スタイルは共通設定どおり。
層ごとに角丸の枠でグルーピングし、左→右＋下部に横断レイヤを置く構成にしてください。

# 上部：メインのデータフロー（左→右）
1. 「利用者」：現場端末・管理者のブラウザ。
2. 「フロント / ゲートウェイ」枠：Azure Front Door（+ WAF）→ Azure Static Web Apps（フロント）と Azure API Management。
3. 「アプリ / エージェント」枠：Azure Container Apps（FastAPI・オートスケール）＋ Azure AI Foundry Agent Service（connected agents ＋ Foundry Observability によるトレース）。
4. 「AI / ナレッジ」枠：Azure OpenAI Service（GPT-4o）／Azure AI Content Safety／Azure AI Search（ハイブリッド検索：キーワード+ベクトル+セマンティック）／Azure Blob Storage（手順書・画像）。
5. 「データ」枠：Azure Cosmos DB（オートスケール）。

# 左側：取り込み（イベント駆動）
- 「設備 / PLC / センサー」→ Azure IoT Hub → Azure Event Hubs → Azure Container Apps（インシデント自動取り込み）。

# 右側：アクション（自動化）
- Azure Container Apps（エージェント）→ Azure Logic Apps / Azure Functions →（橙の実線）→ Microsoft Teams と「保全チケット / CMMS」。

# 下部：横断レイヤ（全体を支える帯）
- 「セキュリティ & 監視」枠として：Microsoft Entra ID（認証）、Azure Key Vault、Managed Identity、Private Endpoint / VNet、Azure Monitor + Application Insights をまとめて配置。

# 矢印
- 主経路は実線。取り込みは左→中央、アクションは中央→右（アクションだけ橙）。
- 下部の横断レイヤからは細い点線を上の各枠へ薄く伸ばし「全体に適用」を示す（線は最小限、ごちゃつかせない）。

# タイトル
- 「Manufacturing Triage Agent ― 本番想定アーキテクチャ（想定・仮 / スケール・セキュリティ・自動化）」

層がきれいに分かれ、エンタープライズ提案資料に載せられる清潔感を最優先にしてください。
```

---

## 図③ ── オンプレ / Edge アーキテクチャ（Azure Local）

> ねらい：製造業の制約（**データを外に出せない・ネットが不安定・低レイテンシ**）に応える**ハイブリッド/エッジ運用**を示す。

```
【図③：オンプレ / Edge（Azure Local）ハイブリッド構成】を1枚の構成図にしてください。スタイルは共通設定どおり。
画面を左右2つのゾーンに分け、中央を Azure Arc が橋渡しする構図にしてください。

# 左ゾーン：「工場（オンプレ / Edge）」枠
- 下段に OT 機器：「PLC / SCADA / センサー / 設備アラーム」→「エッジ ゲートウェイ」。
- 中核に「Azure Local」クラスタの枠。その中に：
  - Foundry Local（ONNX Runtime・GPU/NPU でローカル推論）＝トリアージのLLM推論をオンプレ実行。
  - トリアージ アプリ（FastAPI コンテナ）。
  - ローカル ナレッジ / RAG。
  - ローカル データストア（SQL Edge / ローカル DB）。
- 上段に「現場端末（ブラウザ）」と「現場通知（Teams / オンプレ通知）」。
- このゾーンの隅に強調ラベル3つ：「WAN断でも稼働」「データは工場外に出さない」「低レイテンシ」。

# 右ゾーン：「Azure クラウド（全社管理・ナレッジ）」枠
- Azure Arc（中央管理・ガバナンス）。
- Azure AI Foundry / Azure OpenAI Service（モデルの学習・最適化）。
- 全社ナレッジ：Azure AI Search / Azure Cosmos DB。

# 中央〜ゾーン間の矢印（WAN をまたぐ）
- Azure Arc →（実線「一元管理・更新」）→ Azure Local クラスタ。
- クラウドの Foundry/OpenAI →（点線「最適化済みモデルを配信」）→ Foundry Local。
- 工場のローカルナレッジ ↔ クラウド全社ナレッジ（双方向の点線「WAN 復帰時に同期」）。
- 工場内の推論・トリアージ・通知はすべて左ゾーン内で完結（クラウドに依存しない）ことが一目で分かるように、左ゾーン内の矢印は閉じた流れにする。

# タイトル
- 「Manufacturing Triage Agent ― オンプレ / Edge 運用（想定・仮 / Azure Local + Foundry Local + Azure Arc）」
- キャプション：「クラウドで育て、工場のエッジで止まらず動かすハイブリッド」。

“工場内で完結”と“クラウドと連携”の2つが直感的に伝わる、左右対称で落ち着いたレイアウトにしてください。
```

---

## 補足：より正確な公式ロゴで作りたい場合（任意）

画像生成だと Azure 公式アイコンの形が崩れることがあります。**ロゴの正確さが要る**なら、以下のどちらかが確実です。

- **draw.io（diagrams.net）**：左メニューで Azure 公式アイコンセットを有効化（「More Shapes」→ Networking / Azure）。ChatGPT に「上記①②③の構成を draw.io にインポートできる XML で出力して」と依頼 → draw.io に貼り付け → 公式アイコンで仕上げ。
- **Mermaid（記事埋め込み用）**：本リポジトリの `ARTICLE.md` に記載済みの mermaid 図を使う。Zenn 上でそのまま描画され、テキストで保守できる。プレゼン用の“映える1枚絵”は上の画像生成、記事内の正確な構成は mermaid、と使い分けるのがおすすめ。

> 推奨運用：**プレゼン動画・記事のアイキャッチ = 画像生成（本プロンプト）／ 技術的に正確な構成 = mermaid or draw.io**。
</content>
