---
title: "はじめてのMUSUBIX3：GitHub Copilot CLIで仕様から品質証拠まで作る"
tags:
  - GitHubCopilot
  - TypeScript
  - Python
  - PostgreSQL
  - TDD
private: false
updated_at: "2026-09-08"
id: null
organization_url_name: null
slide: false
ignorePublish: false
---

# 1. はじめに

GitHub Copilot CLIは、設計の相談、コード編集、テスト実行、レビューまでを一つの対話で進められます。
一方で、対話中の「できました」は、そのまま長期保存できる品質証拠ではありません。

そこで本記事では、公開版の
[MUSUBIX3](https://github.com/nahisaho/musubix3)
を使い、仕様から実装、変更管理、品質判定までを一つの独立プロジェクトで通しました。
題材は、TypeScript、Python、PostgreSQLをまたぐ
**在庫管理・需要予測プラットフォーム**です。

実験は2026年9月8日に実施し、ローカルのMUSUBIX3ソースやtarballには依存していません。
利用したのは、公開marketplace `nahisaho/musubix3` と
公開npm package `musubix3@0.1.3`だけです。

最終結果を先に示します。

- npmで解決された版: `musubix3@0.1.3`
- 仕様: 18 requirements / 18 design elements / 4 ADRs
- 実装: TypeScriptとPythonで47ファイル、1,811行
- native tests: TypeScript 14件 + Python 4件 = 18件成功
- strict trace: design / implementation / tests がすべて100%
- strict Code Graph: unresolved local import 0、禁止依存0、cycle 0
- Z3: 18/18要求をモデル化し`sat`
- TDD: 9 Red-Green cycle、うち変更要求でRefactorも記録
- mutation: 必須機能要求8/8、8 mutants killed
- performance: `seriesPointsVisited=65 <= 1000`
- model correspondence: 17/17
- workflow: 8 Skillsのinvokeとstrict transcript検証に成功
- full gate: `pass`
- full-workspace status: `ready=true`
- change readiness: `gate --changed`が`POLICY_APPROVAL_REQUIRED`でblock

したがって、**workspace全体の必須証拠は通過しましたが、変更workflowとしての
最終readyには到達していません**。
新規Git repositoryで全ファイルが未追跡、かつ「commitしない」という実験条件だったため、
`.musubix/policy-baseline.json`に独立承認がないと判定されたためです。
エラーコードは`POLICY_APPROVAL_REQUIRED`でした。

# 2. GitHub Copilotだけでは足りない理由

Copilotは実装を進める主体として非常に強力です。しかし、次の問いに対する答えを
repository内へ機械検証可能な証拠として残すには、会話ログだけでは足りません。

- このコードはどの要求を実装しているか
- 必須要求に設計、実装、テストがすべて存在するか
- Redが本当に失敗し、同じテストのままGreenになったか
- 変更要求が要求→設計→テスト→実装→品質の順で反映されたか
- importや依存方向に違反がないか
- 形式モデルと、実際に成功したテストが対応しているか
- 証拠生成中に入力ファイルが変わっていないか
- 品質ポリシーが都合よく弱められていないか

MUSUBIX3はCopilotを置き換えません。
Copilotが考え、編集し、実行する一方で、MUSUBIX3は
「完了と呼ぶために必要な成果物と証拠」を検査します。

# 3. MUSUBIX3が補完するもの

公開版v0.1.3には、次の8 Skillsが含まれていました。

| Skill | 実験で担当したこと |
|---|---|
| `sdd-change` | 後半のpack-size仕様変更を端から端まで追跡 |
| `sdd-requirements` | EARS要求と測定可能なAcceptanceの整備 |
| `sdd-design` | component、interface、constraint、ADR、Mermaidの検証 |
| `sdd-implementation` | `CODE-*` / `TEST-*`注釈とnative test実行 |
| `sdd-traceability` | 要求→設計→コード→テストのcoverageとimpact |
| `sdd-quality` | 実コマンド、freshness、policy、ready判定 |
| `sdd-knowledge` | ローカル成果物のTF-IDF検索 |
| `sdd-formal-codegraph` | Z3/Lean入力、依存graph、cycle、architecture rule |

重要なのは、SkillsとCLIの役割が分かれている点です。

- Skills: Copilotに「何をどの順序で行うか」を指示する
- CLI: 成果物、fingerprint、実行結果、依存関係を同じ規則で検査する
- gate: 必須証拠が欠ければ`skipped`を成功扱いせず、fail closedする

詳細は[README](https://github.com/nahisaho/musubix3/blob/main/README.md)と
[MUSUBIX2からMUSUBIX3への変更点](https://github.com/nahisaho/musubix3/blob/main/docs/MUSUBIX2-TO-MUSUBIX3.md)
を参照してください。

# 4. 今回開発する在庫・需要予測プラットフォーム

想定利用者は次の3者です。

1. 倉庫担当者: 入出庫と引当を登録する
2. 購買担当者: 需要予測から発注量を判断し、発注書を提出する
3. 運用担当者: PostgreSQLと予測サービスを含むreadinessを確認する

責務は明確に分けました。

| 境界 | 責務 |
|---|---|
| TypeScript / Node.js | HTTP API、商品・在庫・引当・発注・需要取込、予測呼び出し |
| Python | 移動平均、安全在庫、補充量、計算量counter |
| PostgreSQL | 商品、在庫position、movement、reservation、purchase order、demand、audit |
| Docker Compose | API、forecast、PostgreSQLの起動順序とhealthcheck |

主な受入条件は、負在庫防止、冪等な入出庫、引当解除、発注状態遷移、
決定的な予測、倉庫単位の分離、依存障害時のfail closed、監査記録、
操作回数によるperformance budgetです。

```mermaid
flowchart LR
  Client --> API[TypeScript API]
  API --> Workflows[Inventory / Order / Replenishment]
  Workflows --> PG[(PostgreSQL)]
  Workflows --> Forecast[Python Forecast Service]
  Forecast --> Core[Moving Average / Safety Stock / Reorder]
  API --> Health[Readiness]
  Health --> PG
  Health --> Forecast
```

# 5. 前提環境とインストール

確認できた環境は次の通りです。

| Tool | 実測値 |
|---|---|
| GitHub Copilot CLI | `1.0.84-1` |
| Node.js | `v22.22.1` |
| npm | `11.18.0` |
| Python | `3.12.3` |
| Docker Engine | `29.3.0` |
| Docker Compose | `v5.1.0` |
| Z3 | `5.1.0` |
| Lean | 未導入 |
| `psql` | hostには未導入 |

marketplaceは次のコマンドで扱います。

```bash
copilot plugin marketplace add nahisaho/musubix3
copilot plugin marketplace update musubix3-marketplace
copilot plugin install musubix3@musubix3-marketplace
copilot plugin list
```

この環境ではmarketplaceがすでに登録済みだったため、最初の`add`は
`Marketplace "musubix3-marketplace" already registered`となりました。
続く`update`と`install`は成功し、v0.1.3が表示されました。
既存のdirect installも残っていたため一覧には重複表示されました。
通常は[公式READMEの案内](https://github.com/nahisaho/musubix3/blob/main/README.md#distribution-options)どおり、
読み込み経路を一つに統一するのが安全です。

npm側は指定どおりexact installしました。

```bash
npm install --save-dev --save-exact musubix3@0.1.3
npx --no-install musubix3 --version
```

解決結果は次のとおりです。

```json
{
  "version": "0.1.3",
  "resolved": "https://registry.npmjs.org/musubix3/-/musubix3-0.1.3.tgz",
  "integrity": "sha512-b7qfpuh8qfu9cli0i/A/7Fyo79+/ZQWSOO9HBQwu0JsbF0H4Mx1zIFYGAjbW3dttSNHOkBfM6WEezN1Z3W37ig=="
}
```

公開情報:

- [npm: musubix3](https://www.npmjs.com/package/musubix3)
- [GitHub repository](https://github.com/nahisaho/musubix3)
- [v0.1.3 release](https://github.com/nahisaho/musubix3/releases/tag/v0.1.3)
- [Copilot CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)

# 6. プロジェクト初期化と設定

実験はmain repository外の一時workspaceで行いました。公開記事ではlocal usernameと
session識別子を除き、次のように表記します。

```text
$WORKDIR/getting-started-musubix3
```

```bash
mkdir -p "$WORKDIR/getting-started-musubix3"
cd "$WORKDIR/getting-started-musubix3"
git init
npm init -y
npm install --save-dev --save-exact musubix3@0.1.3
npm install fastify@5.12.3 pg@8.23.0 zod@4.5.4
npm install --save-dev \
  @types/node@26.5.0 @types/pg@8.23.1 \
  tsx@4.23.13 typescript@7.0.2 vitest@5.0.0

python3 -m venv .venv
.venv/bin/python -m pip install \
  pytest==9.1.1 pytest-json-report==1.5.0

npx --no-install musubix3 init \
  --feature inventory-forecasting \
  --dry-run --json
npx --no-install musubix3 init \
  --feature inventory-forecasting \
  --json
```

以降に掲載する実装は、47ファイルすべての転載ではなく代表部分です。
同じ構成を試す場合は、Copilotへ次の開発目標を渡し、各節のvalidationを通しながら
段階的に実装します。生成結果は環境とCopilot modelにより同一byte列にはなりません。

```text
sdd-changeを使い、TypeScript/Node.js API、Python需要予測service、
PostgreSQL、Docker Composeからなる在庫・需要予測platformを開発する。
負在庫防止、冪等なmovement、reservation、purchase order状態遷移、
決定的forecast、pack-size単位の補充、dependency readiness、audit、
operation counterを測定可能な要求にする。
要求・設計・ADRを先に検証し、代表must要求はRed-Green-Refactorで実装する。
strict trace、strict Code Graph、Z3、mutation、performance、
model correspondence、workflow、quality gateまで証拠を生成する。
policyを通すために検査を弱めない。
```

`init`で作られた主なものは次です。

```text
.github/skills/sdd-*/
.musubix/config.json
.musubix/policy-baseline.json
.musubix/constitution.md
.musubix/features/inventory-forecasting/requirements.md
.musubix/features/inventory-forecasting/design.md
.musubix/decisions/ADR-0001.md
```

今回の`config.json`では、次をrequiredにしました。以下は方針を示す抜粋であり、
そのまま使う完全な`config.json`ではありません。実ファイルには
`schemaVersion: 1`と、後述する`commands`配列も含めています。

```json
{
  "codeGraph": { "mode": "strict" },
  "formal": { "solver": "z3", "minModeledFraction": 0.8 },
  "mutation": { "mode": "strict" },
  "workflow": { "mode": "strict", "maxAgeSeconds": 86400 },
  "requiredChecks": [
    "requirements", "design", "constitution", "trace", "graph",
    "formal", "model-correspondence", "mutation", "workflow",
    "tdd", "change-history", "change-completeness",
    "performance", "test-identities", "commands"
  ]
}
```

`workflow.maxAgeSeconds`を24時間にしたのは、同日に行った長時間の統合実験で
最初のSkill eventを最終gateまでfreshとして扱うためです。通常運用ではdefaultの
3600秒を維持するか、review cycleに合わせてより短く設定します。

さらに、TypeScript typecheck、Vitest、pytest、performance probe、
mutation harness、`docker compose config`、Compose smoke testの7コマンドを
実行対象にしました。

# 7. sdd-changeで開発を開始する

`sdd-change`は、実装だけを先に終わらせるためのSkillではありません。
要求、設計、Red、実装、Green、品質を順に進めます。

```bash
# 初回は先にindexを作る
npx --no-install musubix3 trace build --json
npx --no-install musubix3 trace check --strict --json
npx --no-install musubix3 graph index --json

npx --no-install musubix3 trace impact REQ-INV-010 --json
npx --no-install musubix3 graph impact forecast_service/reorder.py --json
npx --no-install musubix3 change-record CHANGE-0001 impact \
  --requirement REQ-INV-010 --json
```

本実験では、初期実装後に
「計算した不足数をそのまま返す」から
「仕入先のpack size単位へ切り上げる」へ要求を変更しました。

`.musubix/changes/CHANGE-0001.md`には、変更種別、対象要求、
意図、影響範囲を記録しました。

# 8. 要求をEARS形式で定義する

18件の要求を、MUSUBIX3が検査できるEARS形式で記述しました。
6形式すべてを使っています。

- ubiquitous
- event-driven
- state-driven
- unwanted-behavior
- optional-feature
- complex

例として、負在庫を禁止する要求は次です。

```markdown
## REQ-INV-002: Preserve nonnegative available inventory
Priority: must
Type: functional
Pattern: event-driven
Statement: When an inventory movement is recorded, the system shall preserve a nonnegative available quantity.
Acceptance: TEST-INV-002 verifies that receipts increase stock and an issue below reserved stock returns an inventory error.
Formal: {"kind":"numeric","metric":"inventory.available","operator":">=","value":0,"unit":"units"}
```

検証コマンド:

```bash
npx --no-install musubix3 requirements validate \
  .musubix/features/inventory-forecasting/requirements.md --json
npx --no-install musubix3 constitution validate --json
```

18件すべてが構文検査を通りました。

# 9. 設計・ADR・アーキテクチャを作る

設計も18要素に分け、各要素へ責務、interface、constraint、requirement、
ADR、dependencyを記述しました。

```markdown
## DES-INV-010: Replenishment policy
Responsibilities: Convert forecast demand and inventory context into a supplier-pack replenishment quantity.
Interfaces: recommendReorder(ForecastContext, packSize) returns ReorderRecommendation.
Constraints: A positive raw deficit is rounded upward to one or more whole packs; zero remains zero.
Requirements: REQ-INV-010
ADRs: ADR-0002
Depends-On: DES-INV-008
```

ADRは4件です。

1. TypeScript / Python / PostgreSQLの責務分割
2. 決定的で説明可能な予測
3. atomic command、idempotency、optimistic version
4. PostgreSQL adapterとテスト用memory adapter

```bash
npx --no-install musubix3 design validate \
  .musubix/features/inventory-forecasting/design.md --json
npx --no-install musubix3 design c4 \
  .musubix/features/inventory-forecasting/design.md
```

生成されたMermaidは、手書きの想像ではなく、宣言したcomponentと
`Depends-On`から作られます。

# 10. Red-Green-Refactorを証拠として残す

テスト名に`TEST-*`を入れ、test sourceにも注釈を置きました。

```ts
/** @id TEST-INV-002
 * @verifies REQ-INV-002
 */
test('TEST-INV-002 preserves nonnegative available inventory', () => {
  // 実際のdomain functionを検証
});
```

初期開発では8件の必須要求について、未実装例外を返す最小実装から
実際の失敗を記録し、その後に実装してGreenを記録しました。

```bash
npx --no-install musubix3 tdd red TEST-INV-002 \
  --requirement REQ-INV-002 --command test-ts --json

# 実装後
npx --no-install musubix3 tdd green TEST-INV-002 \
  --requirement REQ-INV-002 --command test-ts --json
```

その後の`REQ-INV-010`変更では、新しい期待値`24`を先に書いてRed、
pack-size切り上げを実装してGreen、最後にrounding関数を分離して
Refactorを記録しました。

v0.1.3で記録した最終的なTDD evidenceは9 cycleで、すべてvalidです。
後述する負のdurationもv0.1.3ではvalidation対象外だったためvalid扱いでした。

# 11. TypeScript API・業務ワークフローを実装する

TypeScript側はHTTPだけでなく、在庫・引当・発注・監査・予測連携を所有します。
domain、application、ports、infrastructure、httpへ分割しました。

負在庫を防ぐdomain logicの要点です。

```ts
/** @id CODE-INV-002
 * @implements REQ-INV-002
 * @design DES-INV-002
 */
export function applyMovement(position: InventoryPosition, command: MovementCommand) {
  assertPositiveInteger(command.quantity, 'quantity');
  const onHand = command.kind === 'receipt'
    ? position.onHand + command.quantity
    : position.onHand - command.quantity;

  if (onHand - position.reserved < 0) {
    throw new DomainError(
      'INSUFFICIENT_INVENTORY',
      'Movement would make available inventory negative.',
      409
    );
  }
  return { ...position, onHand };
}
```

入出庫workflowでは、同じtransaction内で次を行います。

1. idempotency keyを検索
2. 現在positionを取得
3. domain ruleを適用
4. optimistic version付きで保存
5. movement ledgerとauditを追記

APIには商品登録、入出庫、在庫照会、引当、引当解除、発注作成・提出、
需要取込、補充提案、health endpointを実装しました。

# 12. Python需要予測サービスを実装する

Python側は外部モデルを呼ばず、同じ入力には同じ出力を返します。

```python
# @id CODE-INV-008
# @implements REQ-INV-008
# @design DES-INV-008
def forecast_series(history, horizon_days, window=7):
    sample = history[-max(1, window):]
    average = sum(point.quantity for point in sample) / len(sample) if sample else 0.0
    value = round(average, 6)
    return tuple(value for _ in range(horizon_days)), len(sample) + horizon_days
```

再発注計算は次の値を使います。

- 予測期間の需要
- lead time中の平均需要
- safety stock
- `onHand - reserved`
- supplier pack size

変更後の切り上げは独立した純粋関数です。

```python
def round_up_to_pack(quantity: int, pack_size: int) -> int:
    if quantity <= 0:
        return 0
    return ceil(quantity / pack_size) * pack_size
```

HTTP boundaryはPython標準ライブラリの`ThreadingHTTPServer`で構成し、
`/health`と`/forecast`だけを公開しました。

# 13. PostgreSQLとサービス間連携を実装する

PostgreSQLには次のtableを作成しました。

```text
products
inventory_positions
inventory_movements
reservations
purchase_orders
demand_observations
audit_events
```

`inventory_positions`は`(product_id, warehouse_id)`を主キーにし、
`version`によるoptimistic concurrencyを実装しています。
movementの`idempotency_key`にはunique constraintを置きました。

Compose topologyの要点です。
`DATABASE_URL`のcredential部分は公開用にmaskしており、そのままcopyしません。
実装時は`.env`の`POSTGRES_PASSWORD`をComposeへ渡し、
`postgresql://inventory:${POSTGRES_PASSWORD}@postgres:5432/inventory`の形で組み立てます。

```yaml
services:
  postgres:
    image: postgres:16-alpine
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U inventory -d inventory"]
  forecast:
    build:
      context: .
      dockerfile: Dockerfile.forecast
  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    environment:
      DATABASE_URL: postgres://inventory:inventory@postgres:5432/inventory
      FORECAST_URL: http://forecast:8081
```

hostには`psql`がありませんでしたが、Docker daemonは利用できました。
実際に3 serviceをbuild/startし、商品登録、入庫、7日分需要登録、
補充提案までHTTP経由で確認しています。

最終smoke result:

```json
{
  "status": "passed",
  "health": {
    "ready": true,
    "dependencies": {"postgres": "up", "forecast": "up"}
  },
  "recommendedQuantity": 24
}
```

# 14. Traceabilityを100%へ収束させる

コードには次の形式でtrace annotationを置きます。

```ts
/** @id CODE-INV-011
 * @implements REQ-INV-011 REQ-INV-017 REQ-INV-018
 * @design DES-INV-011 DES-INV-018
 */
export class GenerateReorderPlan {
  // ...
}
```

```bash
npx --no-install musubix3 trace build --json
npx --no-install musubix3 trace check --strict --json
npx --no-install musubix3 trace impact REQ-INV-010 --json
```

最終値:

```json
{
  "requirements": 18,
  "designs": 18,
  "codeIds": 19,
  "testIds": 18,
  "edges": 143,
  "coverage": {
    "design": 1,
    "implementation": 1,
    "tests": 1
  }
}
```

ここでの100%は**必須要求に対するlink coverage**です。
振る舞いの正しさそのものは、native tests、mutation、formal correspondenceなどで
別に補強します。

# 15. Code Graphで依存関係とarchitectureを検査する

```bash
npx --no-install musubix3 graph index --json
npx --no-install musubix3 graph impact forecast_service/reorder.py --json
npx --no-install musubix3 graph cycles --json
npx --no-install musubix3 graph gate --json
```

architecture policyには次を含めました。

- domainからinfrastructure / HTTP / `pg` / `fastify`への依存を禁止
- applicationからHTTP / infrastructureへの依存を禁止
- Python forecast coreからHTTP adapterへの逆依存を禁止
- cycleを禁止
- `codeGraph.mode: strict`

最終indexは60 files、192 imports、306 symbols、744 callsでした。
unresolved local import、禁止依存、cycleはいずれも0です。

`graph impact forecast_service/reorder.py`では、Python service、HTTP server、
起動module、performance probe、関連testまでの逆依存経路を確認できました。

# 16. Z3・Leanで制約の整合性を確認する

```bash
npx --no-install musubix3 formal doctor --json
npx --no-install musubix3 formal generate \
  .musubix/features/inventory-forecasting/requirements.md \
  --format both --json
npx --no-install musubix3 formal check \
  .musubix/features/inventory-forecasting/requirements.md \
  --solver z3 --json
npx --no-install musubix3 formal check \
  .musubix/features/inventory-forecasting/requirements.md \
  --solver lean --json
```

Z3は利用可能で、v5.1.0が18/18要求の抽象モデルを`sat`と判定しました。
最終gate内のsolver実行は13 msでした。

Lean入力`Requirements.lean`も生成されましたが、localには`lean`も`lake`もなく、
明示的なLean実行は`solver.status="missing"`、`valid=false`です。
これは成功へ読み替えていません。

また、SATが示すのは宣言したBoolean、numeric、temporal、transition制約の
整合性であり、実装の正しさではありません。

# 17. mutation・performance・model correspondenceを検証する

MUSUBIX3はmutation engineを同梱しないため、この実験では小さな実測harnessを作りました。
各caseで対象sourceを一時的に1か所だけ変更し、対応するnative testが失敗することを確認後、
必ず元のbyte列へ戻します。

```bash
npx --no-install musubix3 mutation doctor --json
node scripts/run-mutations.mjs .musubix/evidence/mutation-report.json
npx --no-install musubix3 gate --json
npx --no-install musubix3 mutation validate --json
```

`run-mutations.mjs`が作るのはschema-v1のraw reportです。
設定済みの`mutationReport` commandをgateが再実行し、hash付きexecutionを
`.musubix/evidence/mutation.json`へ記録した後で`mutation validate`が検証します。

結果は、必須機能要求8件に対して8 mutants、8 killedです。
`mutation.mode`は`strict`のままです。

performanceはwall-clockではなく操作回数で定義しました。

```markdown
Performance: {"counter":"seriesPointsVisited","max":1000,"testId":"TEST-INV-016","unit":"operations"}
```

365日履歴から30日予測を作るcaseで、観測値は`65`、上限は`1000`でした。

18要求のうち17件は明示的な`Formal:`制約、残り1件はStatement由来のliteralとして
formal modelへ入りました。model correspondenceでは、明示的な`Formal:`を持つ17要求すべてについて、
現在のformal model、生成済みtrace、freshなpassing test reportの対応が成立しました。

```bash
npx --no-install musubix3 model-correspondence validate --json
# 17/17
```

# 18. Copilot workflow transcriptとattestationを検証する

repository-localの8 Skillsが実際に読み込まれることを、credentialを置かない
使い捨てworkspaceのnon-interactive Copilot CLI sessionで確認しました。
sessionにはSkill tool以外を使わないよう指示し、8 Skillsを順番に1回ずつinvokeしました。

出力はJSONLとして保存し、home path、tokenらしい文字列、request識別子を
redactした後で検証しました。

```bash
copilot \
  --output-format json \
  --stream off \
  --allow-tool=skill \
  -p 'Skill tool以外を使わず、repository-localの次のSkillsを順に1回ずつinvokeしてください:
      sdd-change, sdd-requirements, sdd-design, sdd-implementation,
      sdd-traceability, sdd-formal-codegraph, sdd-knowledge, sdd-quality。
      ファイル編集、shell、network accessは行わないでください。'

npx --no-install musubix3 workflow-record sdd-change complete \
  --status completed --json
# 残り7 Skillsも各1回

npx --no-install musubix3 workflow-verify \
  evidence/logs/copilot-workflow.sanitized.jsonl \
  --strict \
  --session-id '<YOUR_SESSION_ID>' \
  --json
```

結果は8 declarations / 8 Skills / 146 transcript eventsで、strict verification成功です。
Skill invocationと、各phaseで実行した決定的CLI evidenceは別物として記録しています。
`<YOUR_SESSION_ID>`には、自分のterminal resultが返したsession IDを指定します。

ただし、この確認sessionで`sdd-change complete`を記録した後に、
本実験の`gate --changed`は失敗しました。したがってcomplete宣言は早すぎました。
strict transcript検証は「宣言とSkill eventが対応すること」を確認しますが、
Skill固有の完了条件を代わりに満たすものではありません。実務ではchanged gate成功後に
completeを記録し、失敗時はblockedまたはfailedとして残します。

ローカル環境にはGitHub Actions OIDC identityがないため、local attestationは
`unsigned-local`としてoptional `skipped`にしました。代わりに公開
[v0.1.3 release attestation](https://github.com/nahisaho/musubix3/releases/tag/v0.1.3)
を取得し、JWT本文そのものは保存・掲載せず、次の公開claimだけを確認しました。

- repository: `nahisaho/musubix3`
- commit: `b5116e9fa1fef1deaff8b0cddce21b2c09252b6e`
- GitHub Actions run ID: `34155801297`
- ref: `refs/tags/v0.1.3`
- workflow: `.github/workflows/release.yml`
- Ed25519 signatureとpublic key: present

これは公開releaseのprovenance例の確認であり、
今回のlocal experimentがOIDC署名されたという主張ではありません。

# 19. full gateとchange readinessの違い

通常のfull gateとevidence refreshは成功しました。

```bash
npx --no-install musubix3 evidence refresh --json
npx --no-install musubix3 gate --json
npx --no-install musubix3 status --json
```

full-workspaceの状態:

```json
{
  "gate": {
    "status": "pass",
    "ready": true
  },
  "next": []
}
```

一方、次は失敗しました。

```bash
npx --no-install musubix3 gate --changed --json
```

唯一のblocking diagnosticは次です。

```text
POLICY_APPROVAL_REQUIRED:
The trusted policy baseline changed; independent approval is required before readiness can pass.
```

理由は、fresh repositoryを作った一方で、実験条件に従いcommitしなかったためです。
全ファイルがuntrackedで、policy baselineも「変更対象」と判定されました。
baselineをignoreしたり検査を弱めたりすれば通せますが、それはfail-closedの意図に反します。
そのためchanged gateの失敗を保存しました。通常のfull gateでは
`ready=true`でしたが、`sdd-change`が要求するchange readinessは未達です。
この2つを同じ「最終ready」として扱ってはいけません。

# 20. 実験中に発生した失敗と修正

| 失敗 | 原因 | 修正 |
|---|---|---|
| constitution validation失敗 | v0.1.3で`formal.errors`はconstitution metricの対象外 | formalをrequired checkに保ち、未対応ruleだけ削除 |
| pytest reportからTEST IDを抽出できない | `test_description_TEST_INV_008`では先頭の`test_...`全体がID候補になった | 関数名を厳密な`test_inv_008`形式へ変更 |
| 初回Compose smokeが503 | `pg`の`date`値を`String(...).slice(0,10)`し、非ISO文字列になった | `Date`なら`toISOString().slice(0,10)`へ正規化 |
| trace/graph/testが一時的にstale/fail | sourceを書き換えるmutationと他検査を並列実行した | mutationは直列実行へ変更 |
| 初回full gateのinput-stability失敗 | pytest cache更新とmutation中の`__pycache__`削除 | `-p no:cacheprovider`と`-B`を設定し、mutation中のcache削除を廃止 |
| Lean check失敗 | `lean` / `lake`がlocalにない | Lean artifact生成は保持し、missingを明示。必須solverはZ3 |
| local attestationがskipped | localにCI identityと承認済みsigning keyがない | unsigned-localを正直に保持し、公開release attestationを参照 |
| changed gate失敗 | commit禁止のfresh repoではbaselineが未追跡 | 回避せず`POLICY_APPROVAL_REQUIRED`を記録 |
| TDD evidenceの実行durationが負値 | wall-clockが実行中に後退し、v0.1.3が`Date.now()`差分をそのまま記録 | durationを性能根拠から除外。operation counterだけを採用 |

特にmutationはsourceを短時間でも変更します。
同時にtraceやtestを走らせると、MUSUBIX3のinput-stabilityが正しく異常を検出します。
mutationと他の検証は直列にするべきです。

負のdurationはv0.1.3時点のvalidation gapです。この記事と同時に、
process durationを`performance.now()`でmonotonicに計測し、
負値・非整数を`TDD_DURATION_INVALID`として拒否する修正と回帰testをmusubix3へ追加しました。
この修正を含むversionでは、負のdurationを持つTDD phaseはvalidになりません。

# 21. 8 Skillsが実際に発火した場面

review sessionで、repository-local Skillsを次の順に実invokeしました。

| 順序 | Skill | 対応する実作業 |
|---:|---|---|
| 1 | `sdd-change` | `CHANGE-0001`の7 phase |
| 2 | `sdd-requirements` | 18 EARS requirements |
| 3 | `sdd-design` | 18 components、4 ADRs、C4-like diagram |
| 4 | `sdd-implementation` | 47 implementation files、18 native tests |
| 5 | `sdd-traceability` | strict traceとimpact |
| 6 | `sdd-formal-codegraph` | Z3、Lean probe、strict graph |
| 7 | `sdd-knowledge` | local index/query |
| 8 | `sdd-quality` | evidence refresh、gate、status |

`workflow-record`は自己申告だけなので、それ単独では十分ではありません。
今回はsanitized JSONLの実際のSkill start/completion eventと一対一で照合し、
terminal resultのsession IDとexit codeもstrict modeで確認しました。
ただし前述のとおり、`sdd-change complete`宣言はchanged gateより前に記録したため、
業務上の完了宣言としては無効です。これは実験で見つかった運用上の失敗として残します。

# 22. 実験結果と測定値

| 項目 | 結果 |
|---|---:|
| requirements | 18 |
| design elements | 18 |
| ADRs | 4 |
| implementation files | 47 |
| implementation lines | 1,811 |
| authoritative TEST IDs | 18 |
| TypeScript tests | 14 passed |
| Python tests | 4 passed |
| trace edges | 143 |
| mandatory trace coverage | 100% / 100% / 100% |
| graph files / imports / symbols / calls | 60 / 192 / 306 / 744 |
| graph cycles | 0 |
| formal modeled | 18/18 |
| Z3 result | `sat` |
| TDD cycles | 9 |
| mutation | 8/8 killed |
| performance | 65 / 1000 operations |
| model correspondence | 17/17 |
| workflow | 8/8 Skills、146 events |
| Docker smoke | pass、17.75秒 |
| full evidence refresh | pass、20.92秒 |
| final full gate | pass、21.14秒 |
| full-workspace status | `ready=true` |
| changed gate | fail: `POLICY_APPROVAL_REQUIRED` |
| overall change readiness | blocked |

構造化summaryは実験workspaceの
`evidence/diagnostics/experiment-summary.json`、
最終gateは`.musubix/cache/final-authoritative-gate.json`、
最終statusは`.musubix/cache/final-status.json`に残しました。

# 23. MUSUBIX3が検査できること・保証しないこと

## 設定と証拠に基づいて検査できること

- 設定したvalidationとcommandが実行されたか
- 必須要求へのdesign/code/test linkが揃っているか
- native reportに`TEST-*`の成功があるか
- RedとGreenの順序、test fingerprint、source changeが整合するか
- trace、formal、mutation、performance、workflow evidenceがcurrentか
- 宣言したarchitecture ruleやcycle条件に違反がないか
- full gateで、現在の設定が現在のpolicy baselineより弱くなっていないか
- review可能なGit履歴と`gate --changed`がある場合、baseline自体の未承認変更がないか

## 保証しないこと

- 要求そのものがビジネス的に正しいこと
- trace linkだけで実装意味が正しいこと
- Z3のSATだけでプログラムが正しいこと
- conservative Code Graphがreflectionや動的解決を完全理解すること
- mutation scoreだけで十分なテスト品質があること
- OIDC署名だけでworkflow内の任意処理が意味的に正しいこと
- 単純な移動平均が本番需要予測に最適であること

MUSUBIX3が強くするのは、**明示した約束と、その時点の実行証拠の整合性**です。

# 24. 実務導入時の推奨運用

1. 最初は`minimal`相当から始め、`recommended`、release policyへ段階的に上げる
2. `package-lock.json`と`musubix3`のexact versionをreview対象にする
3. `.musubix/policy-baseline.json`をCODEOWNERSなどで独立承認する
4. requirementは一つの観測可能な義務に分割する
5. `TEST-*`をnative runnerのtest nameにも必ず含める
6. Python pytest adapterでは`test_inv_008`のような正規化可能な名前を使う
7. mutation commandは他のsource readerと並列実行しない
8. test/cache生成物をinput-stabilityへ混入させない
9. performanceはwall-clockだけでなく、固定入力に対するoperation counterで測る
10. `gate --changed`はreview済みbaselineを持つ通常のcommit workflowで使う
11. OIDC attestationはGitHub Actions内で短時間に発行・検証する
12. `status.gate.ready`だけでなく、optional/skippedとlimitationsもrelease noteへ残す

より広い言語・アプリ例は
[既存の実験記事](https://github.com/nahisaho/musubix3/blob/main/docs/qiita-musubix3-application-development.md)
も参考になります。

# 25. まとめ

GitHub Copilot CLIで開発を速めても、仕様、変更理由、検証結果が
repositoryに残らなければ、「なぜreadyなのか」は後から説明しにくくなります。

今回、公開版MUSUBIX3 v0.1.3だけを使い、TypeScript、Python、PostgreSQL、
Docker Composeからなる統合アプリを作り、要求、設計、ADR、TDD、trace、
Code Graph、Z3、mutation、performance、model correspondence、
workflow transcriptまで接続できました。

最終full-workspace gateはpassし、その時点のstatusは`ready=true`でした。
一方で、Lean未導入、local attestation未署名、未commit repositoryでの
changed gate拒否が残り、変更workflow全体のreadyには到達していません。

この「通ったものだけでなく、通らなかった理由も消さない」ことが、
MUSUBIX3をCopilotと組み合わせる最大の価値です。
