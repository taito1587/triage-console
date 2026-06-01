# 04. データモデル（AI生成デモデータ）

## 方針

デモデータは **AI 生成**。全データセットで **設備 ID・エラーコードを一致**させ、
主シナリオ（E-142 / 搬送部異音 / ローラー摩耗で復旧）が end-to-end で通るように設計する。

舞台設定：**第2ライン（L2）= PET ボトル飲料の充填・包装ライン**。

## 設備一覧（共通キー）

| equipment_id | 名称 | 工程 |
|--------------|------|------|
| L2-CONV-01 | 搬送コンベア | 搬送 |
| L2-FILL-01 | 充填機 | 充填 |
| L2-CAP-01 | キャッパー | 打栓 |
| L2-LBL-01 | ラベラー | ラベル貼付 |
| L2-INSP-01 | 検査機（ビジョン） | 検査 |
| L2-PACK-01 | ケーサー | 箱詰め |

## データセット（4種）

各データは Azure AI Search のインデックスに投入する。
共通で `doc_id`, `equipment_id`, `text`（検索本文）, `vector`（埋め込み）を持つ。

### 1. equipment_specs.json — 設備仕様

```json
{
  "doc_id": "spec-L2-CONV-01",
  "equipment_id": "L2-CONV-01",
  "equipment_name": "第2ライン 搬送コンベア",
  "process": "搬送",
  "specs": { "搬送速度": "...", "モーター": "...", "センサー": "..." },
  "error_codes": [
    { "code": "E-142", "meaning": "搬送負荷異常 / 異音検知", "typical_cause": "ローラー摩耗・負荷上昇" }
  ],
  "text": "(検索用にフラット化した本文)"
}
```

### 2. procedures.json — 作業手順書

```json
{
  "doc_id": "proc-conv-roller-check",
  "equipment_id": "L2-CONV-01",
  "title": "搬送ローラー摩耗点検手順",
  "category": "点検",
  "steps": ["1. ...", "2. ...", "3. ..."],
  "text": "(検索用本文)"
}
```

### 3. past_troubles.json — 過去トラブル（実績事例）

```json
{
  "doc_id": "trouble-20251104-L2",
  "equipment_id": "L2-CONV-01",
  "date": "2025-11-04",
  "line": "第2ライン",
  "symptom": "搬送部から異音",
  "error_code": "E-142",
  "root_cause": "搬送ローラー摩耗",
  "action_taken": "ローラー交換",
  "recovery_minutes": 25,
  "responder_note": "段取り替え直後に発生。摩耗が進行していた。",
  "ai_was_correct": null,
  "source": "seed",
  "text": "(検索用本文)"
}
```
> フィードバックで増える事例も同じスキーマ（`source: "feedback"`）。

### 4. quality_records.json — 品質記録

```json
{
  "doc_id": "qa-L2-20251104",
  "equipment_id": "L2-CONV-01",
  "date": "2025-11-04",
  "lot": "L2-1104-A",
  "metric": "ラベル位置ズレ率",
  "value": "1.8%",
  "threshold": "1.0%",
  "judgement": "NG",
  "note": "搬送異音発生時間帯と一致",
  "text": "(検索用本文)"
}
```

## ボリューム（MVP目安）

| データ | 件数 |
|--------|------|
| 設備仕様 | 6（設備ごと1） |
| 作業手順書 | 12〜15 |
| 過去トラブル | 15〜20 |
| 品質記録 | 10〜12 |

合計でも数十件・数百KB程度。Free tier の 50MB に余裕で収まる。

## インデックス設計（Azure AI Search）

- インデックスは **データ種別ごとに分ける**か、`source_type` フィールドで 1 インデックスに統合するか選択。
  MVP は **1 インデックス + `source_type` フィルタ**で簡素化する。
- フィールド：`doc_id`(key), `source_type`, `equipment_id`, `title`, `text`(searchable),
  `vector`(Collection(Edm.Single), HNSW), `date` ほかメタ。
- 検索：`text` の BM25 + `vector` の近傍検索を RRF で統合（hybrid）。
