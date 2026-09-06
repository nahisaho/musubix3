# musubix3

**安定版 v0.1.0 · GitHub Copilot CLI 専用 · Node.js ≥20 · TypeScript · MIT**

[English](README.md)

[musubix2 から musubix3 で変わったこと](MUSUBIX2-TO-MUSUBIX3.md)

要求 → 憲章 → 設計・ADR → 実装 → 追跡可能性 → 品質根拠、という
仕様駆動開発（SDD）を、8つの Skills と決定的な検証エンジンで支援します。
形式的整合性検査、コンパイラによる依存解析、ローカル知識検索も含みます。

[musubix2](https://github.com/nahisaho/musubix2) の考え方を学び、3つの
ワークスペースで新規実装しています。成果物の互換性・移行機能はありません。
ID の接続や SAT 判定だけで、実装の正しさを保証するものではありません。

## クイックスタート

対象プロジェクトで、公開済みパッケージを実行します。

```sh
npx musubix3@0.1.0 --version
npx musubix3@0.1.0 init --dry-run
npx musubix3@0.1.0 init
copilot
```

バージョンを固定してプロジェクトへインストールする場合は、次を実行します。

```sh
npm install --save-dev --save-exact musubix3@0.1.0
npx --no-install musubix3 --version
npx --no-install musubix3 init --dry-run
npx --no-install musubix3 init
```

リポジトリ自体をビルドする場合は、次を実行します。

```sh
git clone https://github.com/nahisaho/musubix3.git
cd musubix3
npm install
npm run build
node dist/packages/cli/src/main.js --help
```

Copilot に「sdd-requirements でこの機能の要求を定義し、設計を計画して」と依頼します。
すべての Skills は入力言語（日本語・英語）に合わせてガイダンスを生成します。

`init`（別名 `install`）は Skills と雛形を配置し、既存ファイルを保持します。
再実行は冪等です。`--force` は名前が決まっている同梱・管理対象だけを置換し、
無関係なファイルを削除しません。先に dry-run を確認してください。
Copilot の内部設定、MCP、LSP、hooks、既存のプロジェクト指示は変更しません。
プロジェクト外へのアクセスとシンボリックリンクへの書き込みは拒否します。

**雛形はリリース可能な状態ではありません。** 実際の要求に置き換え、実装とテストを
行い、検証コマンドを設定してから品質ゲートを実行してください。

## 配布・インストール

同名 Skill の重複を避け、以下の読み込み方法から1つ選んでください。

### ネイティブプラグイン

```sh
copilot plugin install ./musubix3
copilot plugin install nahisaho/musubix3
```

リポジトリ直下の `plugin.json` が唯一のプラグイン定義元であり、
`.github/skills/` を参照します。Git からのプラグイン導入だけでは npm エンジンの
依存解決・ビルドは行われません。CLI は別途ビルド、または npm で導入してください。

`npx musubix3 plugin-install` は `copilot plugin install <package-root>` を実行する
だけで、Copilot 内部を編集しません。永続的なローカルパスには
`npm install --save-dev musubix3` と `npx --no-install musubix3 plugin-install` を推奨します。
一時的な npx キャッシュのパスに依存しないでください。

### ネイティブマーケットプレイス

```sh
copilot plugin marketplace add nahisaho/musubix3
copilot plugin install musubix3@musubix3-marketplace
# ローカル開発
copilot plugin marketplace add ./musubix3
```

カタログは `.github/plugin/marketplace.json`、プラグインの `source` は `.` です。
[Copilot の正式なプラグイン仕様](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
に委譲します。

### リポジトリ内 Skills / npm インストーラー

対象リポジトリで `npx musubix3 init` を実行するか、
`.github/skills/sdd-*` をコピーし、その信頼済みプロジェクトで Copilot を起動します。
`--root <dir>` で対象を指定でき、`--feature <slug>` は雛形のディレクトリ名と
ID 接頭辞を変えます。別機能の追加でも既存設定はリセットしません。

## Skills とネイティブ機能の境界

| Skill | 用途 |
|---|---|
| `sdd-change` | 機能追加・仕様変更・バグ修正を全成果物へ反映し完了判定 |
| `sdd-requirements` | 6種類の EARS と測定可能な憲章 |
| `sdd-design` | 責務・インターフェース・制約、ADR、構成図 |
| `sdd-implementation` | ネイティブ編集による実装とテスト、ID 注釈 |
| `sdd-traceability` | 網羅性、未解決リンク、双方向の変更影響 |
| `sdd-quality` | 実コマンド、ポリシー、品質根拠 |
| `sdd-knowledge` | ローカル成果物・Git 根拠の検索 |
| `sdd-formal-codegraph` | 形式的整合性、依存グラフ、アーキテクチャ |

計画、編集、調査、レビュー、セキュリティレビュー、メモリ、LSP、MCP管理、
サブエージェント・fleet・tasks は **Copilot のネイティブ機能**を使用します。
musubix3 に別の実行基盤、汎用コード・テスト生成、タスクスケジューラー、
MCPサーバー、Claude対応、REPL、常駐watcherはありません。
`status`・`query`・`impact`・`--changed` が必要な一回実行の価値を提供します。
Copilot の提案を記号的検査で制約する構成であり、独自の「ニューロシンボリック」
学習モデルや自動証明能力を主張しません。

## 開発ワークフロー

通常の機能追加、仕様変更、バグ修正には `sdd-change` を使用します。
以下の全工程を統合し、要求・設計・追跡情報が古いままの実装変更を完了扱いにしません。

1. ネイティブ計画・調査で意図と測定可能な受入条件を明確化。
2. `change-record CHANGE-ID impact` を記録してから要求を編集・検証し、
   `requirements` checkpointを記録。
3. コンポーネントとADRを更新して `design` checkpointを記録。
4. 注釈付きテストを作成し、構造化結果を伴う `tdd red` と変更の `red` を記録。
5. 最小実装後に `implementation`、成功する `tdd green`、変更の `green` を記録。
6. 注釈とグラフを更新して変更影響・網羅性を確認。
7. 実コマンドを設定して品質ゲートを実行。必要なレビューとセキュリティレビューは
   別途ネイティブ機能で行い、未実施を成功扱いしない。

```sh
npx musubix3 requirements validate .musubix/features/example/requirements.md --json
npx musubix3 constitution validate --json
npx musubix3 design validate .musubix/features/example/design.md --json
npx musubix3 design c4 .musubix/features/example/design.md
npx musubix3 change-record CHANGE-0001 design --requirement REQ-EXAMPLE-001
npx musubix3 tdd red TEST-EXAMPLE-001 --requirement REQ-EXAMPLE-001 --command test
# テストを変更せず、最小限の振る舞いを実装
npx musubix3 tdd green TEST-EXAMPLE-001 --requirement REQ-EXAMPLE-001 --command test
npx musubix3 tdd refactor TEST-EXAMPLE-001 --requirement REQ-EXAMPLE-001 --command test
npx musubix3 trace build
npx musubix3 trace check --strict --json
npx musubix3 graph index
npx musubix3 graph impact src/service.ts
npx musubix3 gate --changed --json
npx musubix3 status --json
```

## コマンド

分析コマンドは `--root <dir>` と `--json` に対応します。ファイルは root 基準です。
`plugin-install` はパッケージのルートを使います。
終了コードは **0** 成功、**1** 検証・ゲート不合格または要求した solver の失敗、
**2** 引数・I/O・設定エラーです。`status` は情報表示のため未準備でも 0 を返します。

| コマンド | 動作 |
|---|---|
| `init [--dry-run] [--force] [--feature slug]` | 既存ファイル保持の配置。`install` は別名 |
| `plugin-install` | ネイティブ Copilot インストーラーを呼び出す |
| `requirements validate <file>` | ID・優先度・EARS 形式検査 |
| `constitution validate [file]` | 版・原則・測定可能な規則の定義検査 |
| `design validate <file>` | 必須項目・要求ID・既存ADRの参照検査 |
| `design c4 <file>` | 明示的なコンポーネントと依存から Mermaid 図 |
| `trace build` | リポジトリ全体のグラフと機能別コピーを生成 |
| `trace check [--strict]` | 未解決ID、陳腐化、必須要求の網羅性 |
| `trace impact <id-or-path>` | 説明経路付きの双方向探索 |
| `graph index [--changed]` | コンパイラによる依存・宣言・可能な呼び出し先 |
| `graph impact <symbol-or-path>` | 逆依存の推移閉包。`path#name` で曖昧さを回避 |
| `graph cycles` | 強連結成分。循環ありなら終了コード1 |
| `graph gate` | 最新グラフでアーキテクチャ規則を検査 |
| `knowledge build` | Markdown と限定的な Git 根拠を索引化 |
| `knowledge query <text> [--limit 10]` | TF-IDF/cosine のランキングと陳腐化情報 |
| `formal generate <file> [--format both\|smt2\|lean]` | SHA-256付きの再現可能なsolver入力生成 |
| `formal doctor` | Z3、Lean、`lake env lean` の存在とバージョン確認 |
| `formal check <file> [--solver auto\|none\|z3\|lean]` | 明示的なBoolean・条件・数値・時間・状態遷移モデルを検査 |
| `model-correspondence validate` | Formal JSON→生成trace→正本passing testの証拠を再検証 |
| `mutation validate` | 要求scopeのschema-v1 killed-mutant証拠を再検証 |
| `tdd red\|green\|refactor <TEST-ID> --requirement <REQ-ID> --command <name>` | 検証可能なTDDフェーズを実行・記録 |
| `workflow-record <skill> <phase> --status <status>` | 自己申告のworkflow宣言を記録 |
| `workflow-verify <copilot.jsonl> [--strict] [--session-id <uuid>]` | Skillイベントを照合し、任意で完全な成功session transcriptを要求 |
| `attestation oidc-audience --key-id <id> [--public-key-file <pem>]` | 署名鍵を許可するGitHub custom audienceを導出 |
| `attestation payload --provider <name> --run-id <id> --key-id <id> [--public-key-file <pem>] [--github-oidc-token-file <jwt>]` | 外部署名用の正規化CI payloadを出力 |
| `attestation verify` | 静的鍵またはGitHub OIDC認可済みEd25519 provenanceを検証 |
| `change-record <CHANGE-ID> <phase> --requirement <REQ-ID...>` | 段階的変更の成果物・TDD指紋を順序付きで記録 |
| `gate [--changed]` | 検証・実コマンドを集約し品質根拠を保存 |
| `status` | 成果物数と準備状況・陳腐化を表示 |

`--changed` は Git の staged/unstaged/untracked/rename/delete を収集し、
変更・影響を表示します。**安全のため全検査と全設定コマンドを再実行**します。
未実施検査を推測で成功扱いする差分最適化はありません。常駐プロセスもありません。
workflow証拠があれば`workflow`、TDD証拠があれば`tdd`が自動的に必須になります。
`.musubix/changes/CHANGE-*.md` があれば、`requiredChecks` の設定にかかわらず
`tdd`、`change-history`、`change-completeness`がすべて必須になります。

## 成果物スキーマ v1

```text
.github/skills/sdd-*/SKILL.md
.musubix/
  config.json
  constitution.md
  features/<slug>/
    requirements.md
    design.md
    trace.json                 # 生成物。手動編集しない
  decisions/ADR-0001.md
  evidence/
    quality.json                # 初期状態は skipped
    workflow.json               # 宣言と任意のstrict transcript/session根拠
    tdd.json                    # TDD cycleと追記専用ハッシュチェーン
    changes.json                # 変更checkpoint
    order.json                  # TDD/change共通の単調chronology ledger
    performance.json            # 決定的operation budget観測
    model-correspondence.json   # Formal model→trace→fresh passing test証明
    mutation.json               # freshな要求scope mutation実行証拠
    attestation.json            # 任意の外部署名済みCI provenance
  cache/                       # Git除外。索引とsolver入力
```

### 要求・設計

```markdown
---
schemaVersion: 1
feature: auth
---
## REQ-AUTH-001: 期限切れセッションを拒否
優先度: must
種別: functional
パターン: event-driven
要求: セッションが期限切れになったとき、システムは要求を拒否しなければならない。
受入条件: 期限切れ要求に HTTP 401 を返す。
形式制約: {"kind":"conditional","condition":"session.expired","consequence":"request.rejected"}
```

制御された EARS 構文（自由な自然言語の意味解釈ではありません）:

| パターン | 日本語形式 | 英語形式 |
|---|---|---|
| ubiquitous | システムは…しなければならない。 | The system shall … |
| event-driven | …とき、システムは…しなければならない。 | When …, the system shall … |
| state-driven | …間、システムは…しなければならない。 | While …, the system shall … |
| unwanted-behavior | もし…ならば、システムは…しなければならない。 | If …, then the system shall … |
| optional-feature | …場合、システムは…しなければならない。 | Where …, the system shall … |
| complex | …間、…とき、システムは…しなければならない。 | While …, when …, the system shall … |

日本語末尾は `すること` も対応。各要求は1つの文で記述します。
`must`（既定）/`should`/`may` を使用。ID は `REQ-`/`DES-`/`CODE-`/`TEST-` +
英大文字・数字の機能名 + 3桁以上の数字。ADR は `ADR-` + 4桁以上。
リポジトリ全体で重複させないでください。
種別は `functional`（既定）または `non-functional` です。
任意の`Formal:`／`形式制約:`は厳密な1行JSONで、`conditional`、整数
`numeric`、`withinMs`と任意の非負`afterMs`付き`temporal`、
`from`/`event`/`to`付き`transition`だけをモデル化します。数値単位は
`ms`/`s`/`min`を時間、`bytes`/`kib`/`mib`をサイズとして整数で正確に
正規化し、未定義単位や異なる次元は別々に扱います。非機能要求は
`Performance: {"counter":"visitedNodes","max":100,"testId":"TEST-AUTH-002"}`
で決定的な操作回数予算も宣言できます。

`design.md` は以下の形式で、すべての依存コンポーネントを明示します。

```markdown
## DES-AUTH-001: セッションガード
責務: 期限切れセッションからの要求を拒否する。
インターフェース: guard(request) が認証主体または HTTP 401 を返す。
制約: セッショントークンをログに出力しない。
要求: REQ-AUTH-001
決定: ADR-0001
依存: DES-AUTH-002
```

英語ラベルは `Responsibilities` / `Interfaces` / `Constraints` / `Requirements` /
`ADRs` / `Depends-On`。ADR には背景・採用案・却下案・結果を記録します。
C4-like 図は明示した内容だけを描画し、完全な C4 モデルを推論しません。

JS/TS、Rust、Python、Go、Java/Kotlin、C/C++、C#、Ruby、PHP、Swift の
正本となるコード・テストに、エンティティごとに1つのコメントを追加します。
JS/TS では文字列中の記載をリンクとして扱いません。その他の言語では行コメント
またはブロックコメントを使用します。網羅率だけを満たす代理 JS/TS ファイルは作成しません。

```ts
/** @id CODE-AUTH-001
 * @implements REQ-AUTH-001
 * @design DES-AUTH-001
 */
export function guard() { /* 実装 */ }

/** @id TEST-AUTH-001
 * @verifies REQ-AUTH-001
 */
// 実際の振る舞いテスト
```

複数参照は空白・カンマ区切り。`@design` は任意。実装網羅性は要求への直接リンク、
または設計経由で判定し、テストは要求への直接リンクを必要とします。
注釈はテストの正しさを証明しません。機能別 `trace.json` は機能横断の完全な
スナップショット（nodes/edges/diagnostics/入力SHA-256）を保持します。
キャッシュがあれば優先し、削除後は機能別ファイルを使用します。
変更後は再生成が必要で、古いグラフでの影響分析は拒否します。

### 憲章・設定

```markdown
---
version: 1.0.0
---
## PRINC-001: 根拠を優先
### RULE-001: 必須要求の追跡を徹底
指標: trace.errors
上限: 0
```

`requirements.errors` / `design.errors` / `trace.errors` / `graph.violations` /
`formal.errors` / `formal.modeledFraction` / `tests.annotatedIds` /
`tests.executedIds` / `commands.failures` / `commands.skipped` が測定可能です。
`constitution validate` は規則の定義検査であり、実測は `gate` が行います。
根拠が存在しなければ skipped であり、「0件で成功」とは扱いません。

`.musubix/config.json` の例（自分のプロジェクトに合わせて変更）:

```json
{
  "schemaVersion": 1,
  "language": "auto",
  "commands": [
    { "name": "typecheck", "command": "npm", "args": ["run", "typecheck"], "required": true, "timeoutMs": 120000 },
    {
      "name": "test",
      "command": "npm",
      "args": ["test", "--"],
      "adapter": "vitest",
      "required": true,
      "timeoutMs": 120000
    }
  ],
  "requiredChecks": ["requirements", "design", "constitution", "trace", "graph", "commands"],
  "thresholds": { "design": 1, "implementation": 1, "tests": 1 },
  "formal": { "solver": "none", "minModeledFraction": 0, "timeoutMs": 12000 },
  "mutation": { "mode": "compatible" },
  "workflow": {
    "mode": "compatible",
    "maxAgeSeconds": 3600,
    "maxFutureSkewSeconds": 60
  },
  "attestation": {
    "mode": "local",
    "maxAgeSeconds": 3600,
    "maxFutureSkewSeconds": 60,
    "trustedPublicKeys": [],
    "githubOidc": { "mode": "off" }
  },
  "codeGraph": { "mode": "compatible" },
  "architecture": {
    "forbidCycles": true,
    "rules": [
      { "name": "domain-isolation", "from": "src/domain/**", "disallow": ["src/ui/**", "npm:express"] }
    ]
  }
}
```

未知の設定キー、不正な閾値、重複コマンドはエラーです。
glob は `*` / `**` / `?` に対応し、外部依存は `npm:` 接頭辞で表現します。
`codeGraph.mode` の既定値は `compatible` で、未解決の計算された
`import()` / `require()` は警告です。`strict` にするとグラフゲートを阻止する
エラーになります。信頼済みbaselineが `strict` の場合、`compatible` への
弱体化は拒否されます。
網羅性閾値は必須要求に対するリンク網羅率 [0,1] であり、証明ではありません。
必須要求0件は `null`（対象外）です。単独 `trace check --strict` は
100% を要求し、集約ゲートは設定値を使います。
`test-identities` を必須にすると、成功したテストコマンドが生成したfreshな構造化
レポートで、全 `TEST-*` IDが `passed` か照合します。`formal` を必須にすると、
solverと最小モデル化率をゲートに含めます。
明示的な `Formal:` JSON を持つ要求では `model-correspondence` が自動的に必須となり、
現在の形式制約と生成済みtraceから正本 `TEST-*` へ到達し、そのテストがfreshな構造化
command reportでpassしたことを要求します。欠落・改変・stale・未接続はfail closedです。
`tdd` を必須にすると、実際に失敗したRedと、同じコマンド・変更されていない
テストによるGreenを要求します。テスト名・出力には対応する `TEST-*` IDが必要です。
`language` は設定の意図を保持し、Skills は入力言語を優先します。
機械診断コードと詳細は英語、主要な状態表示は日英併記です。

`.musubix/policy-baseline.json` は必須チェック、閾値、アーキテクチャ、
Formalポリシー、mutation mode、workflow strict/session/freshness、CI必須attestation、
strict OIDC identity/key binding、必須コマンド名の最低条件です。弱体化は拒否され、
変更ゲート中のbaseline変更には独立承認が必要です。CODEOWNERS等で保護してください。

**信頼した設定だけを実行してください。** ゲートは環境変数を継承し、シェルを
介さず、時間と出力サイズを制限して実コマンドを動かします。個別の必須コマンドは
集約 `commands` の設定に関係なく失敗・未実行で準備不可になります。
任意コマンドの失敗は非阻止ですが、憲章が失敗件数を制限していれば不合格です。
コマンド未設定は skipped です。

TDD用コマンドには明示的な`tddArgs`と`tddReport`、または組込みの
`vitest`、`jest`、`pytest`、`go-test`、`cargo`、`junit` adapterが必要です。
明示設定を優先し、adapterは対象引数を導出してnative JSON/JSONL/XMLを正規化します。
Vitest/Jestの無関係なskipped結果は対象TDDから除外します。pytestにはJSON pluginと
`test_TEST_APP_001`形式、Goには`TEST-*`名のsubtest、Cargoには`test_app_001`形式、
JUnitには正確な`@Tag("TEST-APP-001")`とIDをunderscore形式で含むmethod名が必要で、
launcherのXML report directoryを読み取ります。各フェーズ前に旧レポートを削除し、
必要なreport親directoryを作成して、対象テストだけを含むfreshな `musubix-json` を要求します。Redは `failed`、
Green/Refactorは `passed` のみ有効で、`skipped`、`error`、未生成、不正形式は失敗です。
Green前にはテスト以外のプロジェクト入力が変更されている必要があります。
異なるテストによる同一フェーズ出力の使い回しは拒否されます。
各フェーズはSHA-256で前レコードと連結した不変レコードとしても追記されます。
TDDと変更checkpointは共通の単調order ledgerを持ち、Red/Green境界ではこれを
正本とし、wall-clock時刻は情報用途に限定します。orderを持たない旧chronologyは
明示的なmigration診断で失敗します。欠落・並べ替え・改変・孤立レコードは
証拠を無効にします。

CIでは6種類すべてについて独立したnative contractを実行します。Vitest、Jest、
`pytest-json-report`付きpytest、Go test、Cargo test、固定版JUnit Platform Consoleの
各fixtureに無関係な失敗テストを置き、生成selectorが対象IDだけを実行し、実際のnative
reportを正規化できることを検証します。Jestは開発時依存だけであり、Python、
Go/Rust、Java/JUnitのtoolingはCIでのみ準備され、packageのruntime依存には含まれません。

変更checkpointは各変更要件にリンクした実装とCode Graph上の依存だけを指紋化するため、
無関係なソース変更では実装フェーズを満たせません。自動必須の
`change-completeness` はCHANGE-IDごとに機能／非機能要件、設計、実在ADR、
コード、テスト、範囲内TDD、トレースに加え、測定可能な受入条件、具体的な設計フィールド、
正本テスト注釈を検査します。各CHANGE文書の`Requirements:`はchronologyと同じ規範要求IDを
正確に列挙する必要があります。構造化テスト結果の`operations` counterで宣言した性能予算を
検査し、経過時間だけでは決定的性能要求を満たしません。
`performance.json` は各観測についてgate生成run identityとSHA-256連結provenanceを保存し、
設定済みcommand名、実行ファイルと展開済み引数、report path/source、fresh report内容、
test ID/status、counter/value、process status/exit codeを結び付けます。検証時には永続化された
file/directory/captured stdout reportを再読込し、欠落・改変、record改ざん、設定drift、
counter source重複、非pass test、成功した設定commandに追跡できない結果を拒否します。
署名対象performance headは安定した意味フィールドだけをhashし、JSONにはrun/execution ID、
timestamp、report hash、連結provenanceを保持するため、同等gateの再実行で署名を壊しません。
このprovenanceはCHANGE completenessとstatus freshnessにも反映されます。
native runner reportはアプリ固有のoperation counterを持たないため、性能予算を使う場合は
計測済み`musubix-json` reportも設定します。
native adapterとcustom reportは併用できますが、性能予算を証明できるのは指定counterを
実際に出力する計測済みreportだけです。

Mutation品質にはcommandへ
`"mutationReport":{"format":"musubix-mutation-json","path":"..."}`を設定します。
freshなschema-v1 mutantは、決定的`MUT-<hash>` identity、must functional requirement、
正本test ID、source/test pathとSHA-256、operator、1始まりline/column、
`killed|survived|skipped|error`を持ちます。gateはcommand/report/process/exit provenanceを
`mutation.json`へ追加します。証拠がある場合、全must functional requirementに現在の
接続済みkilled mutantが必要で、重複・競合・生存・skip・stale・未接続・report改変・
設定driftを拒否します。既定の`compatible`は証拠なしを許容し、releaseでは`strict`と
mutation commandをpolicy baselineで保護します。大規模mutation engineは同梱しません。
mutation/model-correspondenceのsemantic headはattestationに含まれ、元のprovenanceも再検査されます。

品質根拠は状態、必須フラグ、終了コード・出力、実測値、日時、入力の指紋を保存します。
変更ゲートのパス、HEAD、影響範囲は後続の通常ゲートでも保持します。
`workflow-record` は自己申告のSkill、フェーズ、状態、任意コマンドのSHA-256を保存します。
`workflow-verify` はCopilot JSONLからSkill発火メタデータだけを取り込み、完了宣言ごとに
異なる成功完了tool callを順序付きで1対1対応させます。未完了、失敗、再利用、順序違反、
後からの宣言変更は失敗です。
したがって各Skill発火は最終workflow outcomeを1件だけ記録し、複数phaseのchronologyは
重複workflow eventではなく`change-record`に記録します。
`"workflow":{"mode":"strict"}`または`--strict`では、全非空行のJSON、
event timestamp、tool start/completionの1対1整合性、最後に1件だけ存在する
`exitCode: 0`の`result`を追加検査します。terminal `sessionId`、exit code、
event数、terminal時刻、raw source hash、canonical transcript hashを保存します。
`workflow.expectedSessionId`または`--session-id`でcaller申告sessionの置換を拒否します。
strict検証は`workflow.maxAgeSeconds`と`workflow.maxFutureSkewSeconds`で
terminal transcriptの古さと未来方向clock skewも制限します。
並行eventはtimestamp順で出力されない場合があるため、全体sortではなくtool/resultの
因果順序を検査します。
実行中の入力変更は失敗、その後の変更は `status` で stale になります。
`maxAgeSeconds`より古いattestation、または`maxFutureSkewSeconds`を超えて未来の
`issuedAt`は失敗します。local modeは未署名を明示します。

`ci-required`には明確に異なる2つの信頼モードがあります。

- **静的信頼鍵モード**（`githubOidc.mode: "off"`）: `keyId`が設定済み
  Ed25519公開鍵を選び、repository、Git HEAD、CI provider/run ID、証拠head、
  非生成workspace snapshotへの署名を検証します。
- **GitHub OIDC strictモード**: custom audience baseを設定し、GitHub issuer
  metadata/JWKSからRS256 JWTを検証します。issuer、鍵に束縛したaudience、
  `exp`/`nbf`/`iat`、repository、commit `sha`、`run_id`、任意の`workflow`と
  `ref`を照合します。`keyBinding: "public-key"`はattestation内の一時的な
  Ed25519公開鍵をSPKI SHA-256で認可します。`"key-id"`は静的信頼鍵IDへ
  OIDC認可を追加します。metadata/JWKSを取得できない場合はfail closedです。

evidence headは非attestation quality verdictと、formal solver status、要求総数、
modeled count/fraction、consistency、artifact identityも束縛します。quality headから
attestation check自体を除外して循環依存を避けます。`ci-required` attestationの欠落は
skipped/unsigned-localではなくfailed/missingとして報告します。

```json
{
  "attestation": {
    "mode": "ci-required",
    "repository": "owner/repository",
    "maxAgeSeconds": 600,
    "maxFutureSkewSeconds": 30,
    "trustedPublicKeys": [],
    "githubOidc": {
      "mode": "strict",
      "audience": "https://example.invalid/musubix3",
      "keyBinding": "public-key",
      "workflow": "release.yml",
      "ref": "refs/heads/main"
    }
  }
}
```

Ed25519鍵はmusubix3外で生成し、公開PEMだけを`attestation oidc-audience`へ渡します。
その完全一致audienceでGitHub Actions OIDC tokenを要求し、公開PEMとJWT fileを
`attestation payload`へ渡して、出力payloadを外部で署名します。musubix3は秘密鍵を
読み取りも保存もしません。短命JWTは署名済みattestationに含まれ、現在時刻で期限を
検査するため、有効期間内に検証する必要があります。これはGitHub OIDC identityが
署名鍵と記載claimを認可したことを示しますが、runnerの任意動作やworkflowの意味的正しさ
までは証明しません。workflow evidence headは別途transcript/sessionを署名へ束縛します。

## 形式手法・コードグラフ・知識の限界

- 外部solverなしで決定的な整合性検査が可能です。制御された日英の無条件要求はBoolean、
  厳密な`Formal:` JSONは条件分岐ごとの結果、対応単位を正確に正規化した整数境界、
  `afterMs`/`withinMs`区間の共通部分、決定的状態遷移だけを扱います。
  任意の自然言語、同義語、scheduler/liveness、未定義の単位変換、ドメイン公理、
  実装動作は証明しません。
- `consistent` は**モデル化した部分集合だけ**の整合性です。空なら `unknown` で非ゼロ終了。
  `valid` は空でないモデルに検出された違反・要求された実行エラーがないという意味であり、
  全要求の証明ではありません。`none` はsolver未実行。`auto` は Z3 → Lean を探し、
  どちらも未導入なら決定的検査のみ。明示指定したsolverの不在や unknown/timeout/error
  は非ゼロ終了です。成功を偽装しません。
- `formal generate` はsolverがなくても、SHA-256メタデータ付きの再現可能な
  SMT-LIB2／Lean入力を生成します。`formal doctor` は実行ファイル、バージョン、
  timeout、不在、エラーを明示します。
- Z3 は名前付きassertと `check-sat` を含むQF_UFLIA SMT-LIBを実行します。
  Lean は変換されたBoolean、整数、時間、条件scenario、状態遷移命題の
  satisfiabilityまたはcontradiction定理を検査します。
  Leanを汎用SMT solverと称したり、SATを実装の正しさと称したり
  しません。`auto` は `lake env lean` も検出します。非標準パスには
  `--z3-command`、`--lean-command`、`MUSUBIX3_Z3`、`MUSUBIX3_LEAN` を使います。
  入力ファイルは無視対象キャッシュに保存します。
- CI は `lean-toolchain` で Lean を固定し、Z3 と Lean の実統合を両方実行します。
  生成するLeanの充足可能性証明はBoolean全探索ではなく明示的witnessを使います。
  ローカルでは互換バージョンも利用できますが、実行結果には正確なバージョンを記録します。
- JS/TS グラフは import/export、import-equals、リテラル require/dynamic import、
  package manifest entrypoint、安全に静的baseを識別できるcache-busting import、
  最寄りの `tsconfig.json` に対応。呼び出し先は best-effort です。
  シンボル影響は保守的な**ファイル単位**の逆依存になります。
  非リテラル読み込みは既定では警告ですが、`codeGraph.mode: "strict"` では
  グラフゲートを阻止します。未解決外部パッケージは警告、未解決ローカル参照はエラー。
  Rust、Python、Go、Java、C/C++、C#、PHP、R、Juliaはローカル
  import/module/include/source、宣言、直接呼び出しを保守的に解析します。
  その他の言語は未対応として報告します。他言語用の代理 JS/TS ファイルは
  作成しません。
  bundler 独自解決、リフレクションは対象外です。
  build/cache/dependency と symlink は除外しますが、任意の `.gitignore` は
  スキャンフィルターとして読みません。
- 検索は **TF-IDF/cosine** であり GraphRAG でも意味推論でもありません。
  日本語は文字 bigram。Git 根拠は最大100コミット・各30ファイルで、共変更は相関、
  著者別ディレクトリ件数は貢献の記録であって因果や専門性ではありません。
  履歴がない場合は明示的に skipped。外部サービスへは送信しません。
- Node 20 と Node 24（現行LTS）をCI対象とし、Linuxで検証します。
  Windowsの実行ラッパー・プロセスツリー停止はRC保証対象外です。
  ESLintは追加せず、strict TypeScript と既存テストで検証します。

## 開発・リリース検査

```sh
npm install
npm run typecheck
npm run build
npm test
npm pack --dry-run
npm run pack:check
npm run pack:smoke
```

`packages/domain` は純粋な検証、`packages/analysis` は根拠・コンパイラ・
ファイルシステム、`packages/cli` はコマンドと配置を担当します。
ビルド出力は `dist/packages/**`。npm パッケージには隠しSkills、プラグイン定義、
CLI、モジュール、雛形が明示的に含まれます。CI は Node 20/24 を検証します。
`pack:smoke` は実際のtarballを `.test-work/` 内の独立した利用側プロジェクトへ
導入し、実行ファイル・ESM export・配置を確認してから削除します。
attestation APIは`musubix3/analysis`と専用`musubix3/attestation` exportの
両方から利用できます。
[CONTRIBUTING.md](CONTRIBUTING.md) と [CHANGELOG.md](CHANGELOG.md) も参照してください。
