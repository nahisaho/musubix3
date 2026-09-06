# musubix2 から musubix3 で変わったこと

この文書は、[`nahisaho/musubix2`](https://github.com/nahisaho/musubix2) と
`musubix3 v0.1.0` の違いを説明します。

musubix3 は musubix2 の成果物や内部実装を更新した互換バージョンではありません。
musubix2 で得た知見を基に、GitHub Copilot CLI専用のAI Coding Skillsと
決定的な検証エンジンとして新規設計したものです。

## 要約

最も大きな変更は、**独自のAI開発プラットフォームから、GitHub Copilotの作業を
検証可能な証拠で制約するSDDツールへ変わったこと**です。

| 観点 | musubix2 | musubix3 |
|---|---|---|
| 対象 | Copilot、Claude、独自CLI／MCP | GitHub Copilot CLI専用 |
| 基本思想 | 生成・実行・分析機能を広く内包 | Copilotへ生成を委譲し、仕様と証拠を検証 |
| 構成 | 26ワークスペース | `domain`、`analysis`、`cli`の3ワークスペース |
| AI実行 | 独自Agent／Skill registry | CopilotネイティブSkills |
| 常駐機能 | MCP server、REPL、watcher | 一回実行型CLI。常駐サービスなし |
| コード生成 | 独自`codegen`／`test:gen` | Copilotのネイティブ編集を使用 |
| TDD | Phase状態とcoverage policy | 実テスト、TEST ID、fingerprint、hash chain |
| 形式検証 | EARSからBooleanモデル、solver fallbackあり | 明示Formal JSON、Z3／Lean、fail-closed |
| トレース | ID文字列参照を中心にcoverage計算 | 型付きedge、stale検出、双方向impact |
| 品質判定 | 個別機能・policy | 実コマンドと証拠を統合した決定的gate |
| 証拠保護 | 限定的 | Ed25519、GitHub OIDC、改ざん・freshness検査 |
| 配布 | npm CLI、Copilot／Claude assets、MCP設定 | npm、Copilot plugin／marketplace、8 Skills |
| 成果物互換性 | - | musubix2との互換性・自動移行なし |

## 1. 設計思想

### musubix2: 機能を内包するSDDプラットフォーム

musubix2 は要求、設計、タスク分解、コード生成、テスト生成、トレース、
セキュリティ解析、知識管理、研究、合成、Agent実行、MCP serverまでを
単一プロジェクト内に広く実装していました。

主要パッケージには、`workflow-engine`、`agent-orchestrator`、`mcp-server`、
`security`、`deep-research`、`synthesis`などがあります。

参照:

- [musubix2のアーキテクチャ](https://github.com/nahisaho/musubix2/blob/af8f5b0a7562cbea7e38893633b103a3b1cec94d/README-ja.md#L81-L131)
- [musubix2のCLIコマンド定義](https://github.com/nahisaho/musubix2/blob/af8f5b0a7562cbea7e38893633b103a3b1cec94d/src/packages/musubi/src/cli.ts#L124-L259)

### musubix3: Copilotの作業を検証するSkills

musubix3 は計画、コード編集、調査、レビュー、セキュリティレビュー、
subagent実行などをGitHub Copilot CLIへ委譲します。

musubix3自身の責務は次に限定されます。

1. 要求・設計・ADRの構造を検査する
2. 要求、設計、コード、テストの接続を検査する
3. 実行されたテストと変更履歴を証拠として記録する
4. 形式モデルと実装向けテストの対応を検査する
5. 証拠のfreshness、fingerprint、改ざんを検査する
6. 最終的な品質gateを決定的に判定する

この責務境界は[`assets/ADR-0001.md`](assets/ADR-0001.md)と
[`README-ja.md`](README-ja.md)に定義されています。

## 2. アーキテクチャ

### musubix2

- 26ワークスペース
- 独自Agent orchestrator
- 独自Skill manager
- stdio／SSE MCP server
- REPL、watcher
- メモリ内のworkflow／trace stateを含む複数サブシステム

musubix2の`SubagentDispatcher`はAgent specとtask状態を管理し、
Skill managerはtriggerとexecutorを独自registryへ登録していました。

参照:

- [Agent orchestrator](https://github.com/nahisaho/musubix2/blob/af8f5b0a7562cbea7e38893633b103a3b1cec94d/src/packages/agent-orchestrator/src/index.ts#L8-L107)
- [Skill manager](https://github.com/nahisaho/musubix2/blob/af8f5b0a7562cbea7e38893633b103a3b1cec94d/src/packages/skill-manager/src/index.ts#L8-L133)

### musubix3

```text
packages/
├── domain/    # 要求、設計、憲章などの構文と型
├── analysis/  # trace、graph、formal、TDD、gate、attestation
└── cli/       # musubix3 CLIとinstaller
```

独自Agent runtime、MCP server、REPL、watcherはありません。Skillsは
GitHub Copilot CLIが直接読み込み、CLIは検証が必要な時だけ実行されます。

## 3. Skillsの変更

### musubix2の8 Skills

- `orchestrator`
- `requirements-analyst`
- `design-generator`
- `code-generator`
- `test-engineer`
- `traceability-auditor`
- `constitution-enforcer`
- `review-orchestrator`

参照:
[musubix2 Skills](https://github.com/nahisaho/musubix2/blob/af8f5b0a7562cbea7e38893633b103a3b1cec94d/README-ja.md#L222-L235)

### musubix3の8 Skills

- `sdd-change`
- `sdd-requirements`
- `sdd-design`
- `sdd-implementation`
- `sdd-traceability`
- `sdd-quality`
- `sdd-knowledge`
- `sdd-formal-codegraph`

musubix3のSkillは別のAI runtimeを起動するものではありません。Copilotへ
作業手順、守るべき境界、必要な証拠、最後に実行する検証コマンドを指示します。

| musubix2 | musubix3での扱い |
|---|---|
| `orchestrator` | `sdd-change`が変更全体を統合 |
| `requirements-analyst` | `sdd-requirements` |
| `design-generator` | `sdd-design`。生成操作自体はCopilotへ委譲 |
| `code-generator` | `sdd-implementation`。独自generatorは廃止 |
| `test-engineer` | `sdd-implementation`と`sdd-quality`、TDD CLI |
| `traceability-auditor` | `sdd-traceability` |
| `constitution-enforcer` | `sdd-requirements`と品質gate |
| `review-orchestrator` | `sdd-quality`とCopilotネイティブreview |

## 4. 開発ワークフロー

### musubix2

標準フローは次の5段階でした。

1. Requirements
2. Design
3. Task Breakdown
4. Implementation
5. Completion

Task Breakdownでは`TASK-*`、依存DAG、要求・設計リンク、テストタスクを
独立成果物として管理します。

参照:

- [musubix2 orchestrator workflow](https://github.com/nahisaho/musubix2/blob/af8f5b0a7562cbea7e38893633b103a3b1cec94d/src/.github/skills/orchestrator/SKILL.md#L41-L70)
- [musubix2 task breakdown](https://github.com/nahisaho/musubix2/blob/af8f5b0a7562cbea7e38893633b103a3b1cec94d/src/.github/skills/orchestrator/SKILL.md#L156-L188)

### musubix3

通常の変更は`sdd-change`で次の順序を扱います。

1. impact
2. requirements
3. design
4. red
5. implementation
6. green
7. quality

各段階は`change-record`で記録されます。要求変更後の新しいRedと、
実装変更後のGreenを要求し、単調なorder ledgerで前後関係を判定します。

独立したタスク生成サブシステムの代わりに、Copilotの計画機能と、
要求単位のTDD・trace・quality evidenceを接続します。

## 5. TDD

### musubix2

musubix2には`red → green → refactor`の状態遷移とcoverage thresholdが
ありました。ただし、中心となる実装はメモリ上のphase trackerであり、
次の情報とは直接結び付いていませんでした。

- 実際に実行したコマンド
- 対象TEST ID
- テストファイルのfingerprint
- 実装ファイルのfingerprint
- 改ざん検知可能な履歴

参照:
[musubix2 test-first policy](https://github.com/nahisaho/musubix2/blob/af8f5b0a7562cbea7e38893633b103a3b1cec94d/src/packages/policy/src/test-first.ts#L6-L94)

### musubix3

musubix3のTDDは実行証拠を要求します。

- Redは対象TEST IDが失敗し、processがnonzero exitであること
- Green／Refactorは対象TEST IDが成功し、zero exitであること
- Red後にテストが変更されていないこと
- Green前に対象実装が変更されていること
- command、args、stdout／report、source、testのfingerprint
- Red／Green／RefactorのSHA-256 chain
- 変更段階と共有する単調order ledger

組込みadapterはVitest、Jest、pytest、Go test、Cargo、JUnitです。

## 6. 成果物とトレーサビリティ

### 配置の変更

musubix2:

```text
steering/
storage/specs/requirements.md
storage/specs/designs/
storage/specs/plans/
storage/specs/reviews/
```

musubix3:

```text
.musubix/
├── config.json
├── policy-baseline.json
├── constitution.md
├── features/<slug>/
│   ├── requirements.md
│   ├── design.md
│   └── trace.json
├── decisions/ADR-*.md
└── evidence/
    ├── quality.json
    ├── workflow.json
    ├── tdd.json
    ├── changes.json
    ├── order.json
    ├── performance.json
    ├── model-correspondence.json
    ├── mutation.json
    └── attestation.json
```

### 検査方法の変更

musubix2のCLI traceは、要求IDがソースに存在するかを中心にcoverageを
計算していました。

参照:
[musubix2 trace CLI](https://github.com/nahisaho/musubix2/blob/af8f5b0a7562cbea7e38893633b103a3b1cec94d/src/packages/musubi/src/cli.ts#L583-L704)

musubix3は次の型付きnodeとedgeを生成します。

- node: requirement、design、code、test、ADR
- edge: `satisfies`、`implements`、`verifies`、`decides`、`depends-on`

さらに、重複ID、dangling edge、存在しないsource、stale fingerprint、
must要求のcoverage、双方向impact pathを検査します。

ただし、どちらのバージョンでも**リンクの存在だけで実装の正しさが証明される
わけではありません**。musubix3はこの制約を明示し、実テスト証拠や
形式モデル対応を別gateとして追加しています。

## 7. 形式検証

### musubix2

musubix2はEARS要求からBoolean変数とSMT-LIB2を生成します。
Z3が利用できない場合はmock solverへフォールバックする経路があり、
実solverがなくても`sat`相当の結果になる場合がありました。

参照:

- [musubix2 formal model](https://github.com/nahisaho/musubix2/blob/af8f5b0a7562cbea7e38893633b103a3b1cec94d/src/packages/formal-verify/src/index.ts#L141-L280)
- [musubix2 solver fallback](https://github.com/nahisaho/musubix2/blob/af8f5b0a7562cbea7e38893633b103a3b1cec94d/src/packages/formal-verify/src/index.ts#L309-L444)

### musubix3

musubix3は、検証可能な意味を明示した要求だけをモデル化します。

- controlledな無条件Boolean要求
- conditional
- exact integer numeric bounds
- temporal interval
- deterministic state transition

複雑なモデルは要求内の`Formal:` JSONで定義します。未対応要求は
`unsupported`として報告し、推測で意味を補いません。

solver状態は`not-requested`、`missing`、`sat`、`unsat`、`checked`、
`unknown`、`timeout`、`error`に分離されます。明示的に要求したZ3／Leanが
利用できない場合や失敗した場合は、成功として扱いません。

さらにP4では、Formal modelをfreshなtraceとauthoritativeな成功テストへ
接続するmodel correspondence gateが追加されました。

## 8. Code Graphと言語対応

### musubix2

専用multi-language parserはPython、Java、Go、Rust、Ruby、PHPを対象とし、
未知言語にはregex fallbackを使用します。

参照:
[musubix2 multi-language parser](https://github.com/nahisaho/musubix2/blob/af8f5b0a7562cbea7e38893633b103a3b1cec94d/src/packages/codegraph/src/multi-lang-parser.ts#L183-L187)

### musubix3

用途ごとに対応範囲を分けています。

**トレース注釈**

- JavaScript／TypeScript
- Rust
- Python
- Go
- Java／Kotlin
- C／C++
- C#
- Ruby
- PHP
- Swift

**依存・シンボル・直接呼出しグラフ**

- JavaScript／TypeScript: TypeScript compiler API
- Rust
- Python
- Go
- Java
- C／C++
- C#
- PHP
- R
- Julia

非JavaScript／TypeScript言語は保守的adapterであり、reflectionや
bundler固有の動的解決を完全に再現するものではありません。

## 9. 品質証拠とセキュリティ

### musubix2

musubix2には独自security scannerがあり、injection、XSS、secret、
dependency、prompt injection、path traversalなどを主に静的heuristicで
検査していました。

参照:
[musubix2 security package](https://github.com/nahisaho/musubix2/blob/af8f5b0a7562cbea7e38893633b103a3b1cec94d/src/packages/security/src/index.ts#L1-L39)

### musubix3

汎用security scannerは持たず、Copilotのネイティブsecurity review、
CodeQL、Dependabotなどへ委譲します。

一方、開発プロセスの証拠保護は強化されています。

- policy baselineの弱体化拒否
- 実コマンド、exit code、構造化report
- source／test／report fingerprint
- freshnessとstale evidence検出
- append-only TDD／change hash chain
- workflow transcriptとSkill callの1対1照合
- session ID、時刻、tool lifecycle検証
- deterministic performance counter
- requirement-scoped mutation evidence
- Ed25519 attestation
- GitHub Actions OIDC、JWKS、claim、key binding

セキュリティscannerの置換ではないため、musubix2の`security`を使用していた
プロジェクトでは、別のSAST・dependency・secret scanningを維持してください。

## 10. CLIの変更

### musubix3に残った、または再設計された機能

| 目的 | musubix3 |
|---|---|
| 要求検査 | `requirements validate` |
| 憲章検査 | `constitution validate` |
| 設計検査 | `design validate` |
| C4生成 | `design c4` |
| トレース | `trace build/check/impact` |
| Code Graph | `graph index/impact/cycles/gate` |
| ローカル検索 | `knowledge build/query` |
| 形式検証 | `formal generate/doctor/check` |
| モデル対応 | `model-correspondence validate` |
| Mutation証拠 | `mutation validate` |
| TDD証拠 | `tdd red/green/refactor` |
| Skill照合 | `workflow-record`、`workflow-verify` |
| 変更履歴 | `change-record` |
| 署名証拠 | `attestation ...` |
| 集約判定 | `gate` |
| 状態表示 | `status` |

### 廃止またはCopilotへ委譲された代表的コマンド

- `req:wizard`、`req:interview`
- `design generate`
- `tasks`
- `codegen`
- `test:gen`
- `security`
- 独立した`policy`／`ontology`
- `decision`
- `deep-research`
- `explain`
- `learn`
- `synthesis`
- `skills create`
- `scaffold`
- `repl`
- `watch`
- `mcp`
- `dfg`

これらは単なる名称変更ではありません。生成、調査、レビュー、
タスク管理などはCopilotのネイティブ機能を使い、musubix3は結果を検証します。

## 11. 配布とインストール

### musubix2

- CLI名: `musubix`、`musubix2`
- CopilotとClaude向けassets
- `.vscode/mcp.json`、`.mcp.json`を生成
- `init --platform auto|copilot|claude|both`

参照:
[musubix2 installer](https://github.com/nahisaho/musubix2/blob/af8f5b0a7562cbea7e38893633b103a3b1cec94d/src/packages/musubi/src/interface/cli/init-command-handler.ts#L63-L126)

### musubix3

- CLI名: `musubix3`
- GitHub Copilot CLI専用
- Copilot native plugin
- Copilot native marketplace
- npm installerによるrepository-local Skills
- MCP、LSP、hooks、既存project instructionsを変更しない
- 既存ファイルを保持し、`--force`も管理対象pathだけを置換

```sh
npm install --save-dev --save-exact musubix3@0.1.0
npx --no-install musubix3 init --dry-run
npx --no-install musubix3 init
```

## 12. 成果物互換性

musubix2からmusubix3への自動変換機能はありません。

次の成果物はそのまま再利用できません。

- `steering/**`
- `storage/specs/**`
- musubix2のtrace／knowledge／workflow state
- musubix2のTDD phase state
- musubix2が生成したformal solver結果
- musubix2のMCP設定
- Claude向けSkillsと設定

理由は、保存場所だけでなく、ID、schema、fingerprint、freshness、
execution report、hash chain、attestationの要件が変わっているためです。

## 13. 推奨移行手順

1. 別branchで移行を開始し、musubix2成果物を参照用に保持する。
2. `musubix3@0.1.0`をexact dev dependencyとして導入する。
3. `init --dry-run`で作成・保持されるpathを確認する。
4. `init`を実行する。生成されたexampleを完成済み成果物と見なさない。
5. 旧要求を選別し、`.musubix/features/<slug>/requirements.md`へ書き直す。
6. priorityを`must`、`should`、`may`として再評価する。
7. 設計を`design.md`、判断を`.musubix/decisions/ADR-*.md`へ移す。
8. 正本コードとテストへ`@id`、`@implements`、`@design`、
   `@verifies`注釈を追加する。
9. `trace build`と`trace check --strict`を実行する。
10. `.musubix/config.json`へ実際のtest、build、typecheck commandを設定する。
11. must要求ごとに新しいRedからTDD証拠を記録する。
12. 必要な要求だけを`Formal:` JSONとして再モデル化する。
13. `gate --changed --json`を実行する。
14. strict workflow、mutation、attestationを段階的に有効化する。
15. 旧`security` CLIの代替となるSAST、dependency、secret scanningをCIへ追加する。

## 14. どちらを選ぶべきか

### musubix3が適している場合

- GitHub Copilot CLIを中心に開発する
- 仕様変更からテスト・実装までの順序を証明したい
- 実コマンドと構造化reportを品質gateへ接続したい
- Z3／Leanをfail-closedで実行したい
- CI証拠のfreshnessと改ざんを検査したい
- 独自AI runtimeやMCP serverを保守したくない

### musubix2の機能を別途補う必要がある場合

- Claude向けassetsが必要
- 独自MCP serverが必要
- `codegen`、`test:gen`、`deep-research`などの専用コマンドが必要
- 組込みsecurity heuristicを継続利用したい
- 旧`storage/specs/**`成果物を変更せず使いたい

musubix3へ移行する場合、これらはCopilotネイティブ機能または外部ツールへ
置き換える必要があります。

## 関連資料

- [musubix3 README（日本語）](README-ja.md)
- [musubix3 README（English）](README.md)
- [musubix3 CHANGELOG](CHANGELOG.md)
- [musubix3 architecture decision](assets/ADR-0001.md)
- [musubix2 repository](https://github.com/nahisaho/musubix2)
- [musubix2 README（日本語）](https://github.com/nahisaho/musubix2/blob/af8f5b0a7562cbea7e38893633b103a3b1cec94d/README-ja.md)
