# musubix3

**最新リリース v0.1.12 · GitHub Copilot CLI 専用 · Node.js ≥20 · TypeScript · MIT**

[English](README.md)

[musubix2 から musubix3 で変わったこと](docs/MUSUBIX2-TO-MUSUBIX3.md)

GitHub Copilotは、計画、コード生成、編集、テスト、レビューを実行できます。
musubix3は、repository-localな仕様と、設定した品質プロファイルが要求する
根拠を決定的かつfail-closedに検査する仕組みを追加します。
要求 → 憲章 → 設計・ADR → 実装 → 追跡可能性 → 品質根拠を、
8つのSkillsと検証CLIで接続します。

[musubix2](https://github.com/nahisaho/musubix2) の考え方を学び、3つの
ワークスペースで新規実装しています。成果物の互換性・移行機能はありません。
ID の接続や SAT 判定だけで、実装の正しさを保証するものではありません。

## GitHub Copilotだけでは足りない理由

Copilotは実装を担うエンジンです。要求を理解し、repositoryを調査し、計画を立て、
ファイルを編集し、toolを実行して結果を説明します。これは不可欠ですが、
会話が成功したことだけでは、次を継続的に証明できません。

- 実装した振る舞いが、明示的で測定可能な要求と一致しているか
- すべての要求が設計、コード、正本テストまで接続されているか
- テストを書き換えず、本当にRedが先に失敗してGreenが成功したか
- test、graph、formal、qualityの結果が現在のsourceに対して新鮮か
- 要求変更が影響する成果物へ正しい順序で伝播したか
- 最終gateを通すためにpolicyを弱めていないか

「テストは成功しました」「実装は完了しました」という会話上の報告は、
古くなる、範囲が不足する、repository外で失われる可能性があります。
推論と開発はCopilotへ任せたまま、musubix3が完了条件を永続化し、
機械検証できる形へ変換します。

| GitHub Copilotが提供するもの | musubix3が補完するもの |
|---|---|
| 計画、実装、refactor、tool実行 | 明示的な要求、設計判断、実装link、完了条件を要求するrepository-local SDD Skills |
| テスト生成とtest runner実行 | 構造化TEST ID、native report正規化、検証可能なRed/Green/Refactor証拠 |
| 変更内容の説明 | 要求 → 設計 → コード → テストの型付きtraceと双方向impact解析 |
| repository調査 | 決定的なCode Graph、未解決local dependency診断、architecture gate |
| 制約・不変条件の提案 | 任意のZ3/Lean整合性検査と、形式モデルから成功テストまでの対応検査 |
| session単位の完了報告 | freshness、fingerprint、input stability、保護されたpolicy baseline、attestation、fail-closedなready判定 |

musubix3はCopilotを置き換えず、別のcoding agentも追加しません。
SATだから実装が正しいとも主張しません。開発はCopilotが実行し、
musubix3は仕様を残し、必須証拠を検査し、古い・不完全な必須証拠を拒否して、
「なぜ設定したpolicyがこの変更をreadyと判断したのか」をreview可能な形で
repositoryへ残します。

## クイックスタート

再現可能なproject-local環境として、exact versionを導入します。

```sh
npm install --save-dev --save-exact musubix3@latest
npx --no-install musubix3 --version
npx --no-install musubix3 init --dry-run
npx --no-install musubix3 init
copilot
```

継続利用するSkill内CLIのversionを固定しない、単発評価だけなら次を使えます。

```sh
npx musubix3@latest --version
npx musubix3@latest init --dry-run
```

生成されたSkillsを継続開発で使う前にexact local dependencyを導入してください。
Skillsのコマンドはrepository-localな`npx --no-install musubix3`を使用します。

リポジトリ自体をビルドする場合は、次を実行します。

```sh
git clone https://github.com/nahisaho/musubix3.git
cd musubix3
npm install
npm run build
node dist/packages/cli/src/main.js --help
```

Copilot に「sdd-changeを使ってこの機能を追加し、仕様、実装、追跡可能性、
品質ゲートまで一貫して反映して」と依頼します。
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
`npm install --save-dev --save-exact musubix3@latest` と
`npx --no-install musubix3 plugin-install` を推奨します。
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

exact local dependencyの導入後に対象リポジトリで
`npx --no-install musubix3 init`を実行するか、
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

「○○を開発・作成・実装」のような自然言語依頼では、`sdd-change`を必須の
最初のSkillとして発火させ、コード実装前に要求を確認・検証して設計を確定します。
承認済みの要求・設計を実装する明示的な依頼だけが`sdd-implementation`へ直接進めます。
要求または設計が存在しない、あるいは検証に失敗する場合、実装Skillは停止します。
要求に必要なコンテキストが不足している場合は、優先度が最も高い質問を1問だけ行い、
回答を待ってから次の1問へ進みます。質問をまとめず、未解決事項がなくなるまで
要求を確定しません。

1. ネイティブ計画・調査で意図と測定可能な受入条件を明確化。
2. `change-record CHANGE-ID impact` を記録して要求を編集・検証し、
   `requirements` checkpoint後、設計前にartifact-boundな人間の
   `requirements`承認を明示的に記録。
3. コンポーネントとADRを更新して `design` checkpointを記録し、
   実装前にartifact-boundな人間の`design`承認を明示的に記録。
4. 注釈付きテストを作成し、構造化結果を伴う `tdd red` と変更の `red` を記録。
5. 最小実装後に `implementation`、成功する `tdd green`、変更の `green` を記録。
6. 注釈とグラフを更新して変更影響・網羅性を確認。
7. 実コマンドで候補品質ゲートを実行。承認以外の必須checkがすべて合格した後、
   人間が`release`承認を記録してgate/statusを再実行し、その後だけ
   commit・push・publish・deployへ進む。検証結果や自然言語から承認を推測しない。

```sh
npx musubix3 requirements validate .musubix/features/example/requirements.md --json
npx musubix3 constitution validate --json
npx musubix3 approval prepare requirements --json
npx musubix3 approval record requirements --approver "要求責任者" --artifact-sha256 "$REVIEWED_HASH" --confirm
npx musubix3 design validate .musubix/features/example/design.md --json
npx musubix3 design c4 .musubix/features/example/design.md
npx musubix3 approval prepare design --json
npx musubix3 approval record design --approver "設計責任者" --artifact-sha256 "$REVIEWED_HASH" --confirm
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
npx musubix3 approval prepare release --json
npx musubix3 approval record release --approver "リリース責任者" --artifact-sha256 "$REVIEWED_HASH" --confirm
npx musubix3 gate --changed --json
npx musubix3 approval validate --json
npx musubix3 status --json
```

### 別の要求の実装の副作用としてすでに満たされている要求

`tdd red` はすでに成功しているtestのRed記録を拒否します（`TDD_TARGET_RESULT`）。
これはバグではなく正しい挙動です。あるrequirementのために書いた正しく汎用的な
実装が、別のまだ未実装のrequirementも副作用として満たしてしまうこと（例:
汎用的なcapacity-aware割当algorithmが、別のrequirementが求める「利用可能な
resourceがない」edge caseも正しく処理してしまう場合）はありえます。この場合
のためにRedを迂回する`--already-satisfied-by`のような宣言はあえて提供して
いません。「他所ですでに満たされている」という人間の宣言は測定された根拠では
なく、それを受理してしまうと未実装または誤って実装されたrequirementが検証
されないままgateを通過しかねないためです。

推奨する方法は、他のrequirementと同じように genuine なRedを証明することです。
すでに正しい共有実装を一時的に意図的に狭め、新しいrequirementのtestを
実際に失敗させて`tdd red`を記録し、正しい実装を復元して`tdd green`を記録
します。

```sh
# 共有実装はすでに正しい。TEST-EXAMPLE-002を実際に失敗させるために、
# 一時的に実装を狭める（例: 汎用algorithmがすでに包含している特殊ケースを
# 一時的に再度別処理として書き戻すなど）。
npx musubix3 tdd red TEST-EXAMPLE-002 --requirement REQ-EXAMPLE-002 --command test
# 正しい（すでに書かれている）実装に戻す。他のコード変更は行わない。
npx musubix3 tdd green TEST-EXAMPLE-002 --requirement REQ-EXAMPLE-002 --command test
```

狭める変更はその場限りに留め、Green記録と同じ手順内で必ず元に戻してください。
弱めたコードをどの時点でもcommitしたままにしないでください。

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
| `approval prepare <requirements\|design\|release>` | 人間が確認する決定的manifestとhashを表示 |
| `approval record <stage> --approver <name> --artifact-sha256 <hash> --confirm` | 確認済みhashが現在も一致するときだけ承認を記録 |
| `approval validate` | 各承認をapproved・missing・staleとして表示し、検証結果から承認を推測しない |
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
| `mutation doctor` | 言語別のローカルmutation engine確認と導入推奨 |
| `formal check <file> [--solver auto\|none\|z3\|lean]` | 明示的なBoolean・条件・数値・時間・状態遷移モデルを検査 |
| `model-correspondence validate` | Formal JSON→生成trace→正本passing testの証拠を再検証 |
| `evidence refresh [--changed]` | 同じfail-closed gate pipelineで派生証拠を再生成 |
| `mutation validate` | 要求scopeのschema-v1 killed-mutant証拠を再検証 |
| `mutation identity <REQ-ID> <TEST-ID> <sourcePath> <operator> <line> <column>` | mutation reportが宣言すべき決定的な`MUT-*`識別子を出力 |
| `tdd validate` | 保存済みRed/Green/Refactorの順序、指紋、実行時間、hash-chainを検証 |
| `tdd red\|green\|refactor <TEST-ID> --requirement <REQ-ID> --command <name>` | 検証可能なTDDフェーズを実行・記録 |
| `workflow-record <skill> <phase> --status <status>` | 自己申告のworkflow宣言を記録 |
| `workflow-sanitize <copilot.jsonl> <output-file> [--session-id <uuid>]` | reviewやstrict検証前にmessageとSkill以外のtool dataを除去 |
| `workflow-verify <copilot.jsonl> [--strict] [--session-id <uuid>]` | Skillイベントを照合し、任意で完全な成功session transcriptを要求 |
| `attestation oidc-audience --key-id <id> [--public-key-file <pem>]` | 署名鍵を許可するGitHub custom audienceを導出 |
| `attestation payload --provider <name> --run-id <id> --key-id <id> [--public-key-file <pem>] [--github-oidc-token-file <jwt>]` | 外部署名用の正規化CI payloadを出力 |
| `attestation verify` | 静的鍵またはGitHub OIDC認可済みEd25519 provenanceを検証 |
| `change-record <CHANGE-ID> <phase> --requirement <REQ-ID...>` | 段階的変更の成果物・TDD指紋を順序付きで記録 |
| `config lint` | `args`が存在しないrepository相対パスを参照する設定済みコマンドを報告 |
| `config scaffold` | 検出したGo/Rust/Maven/Python/Nodeツールチェーン向けのnative test-command候補を`.musubix/config.json`へ書き込まずに提案 |
| `gate [--changed] [--feature <name>]` | 検証・実コマンドを集約し品質根拠を保存。`--feature`は requirements/design/trace/tdd/change-history/change-completeness の検査を1機能へ限定する診断用途で、repository全体のgateの代替ではない |
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
    model-correspondence.json   # Formal model→trace→fresh passing testの対応証拠
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
本質的にADRに値する決定が存在しないcomponentは、実際のADR参照の代わりに
`ADRs: none — <具体的な理由>`（プレースホルダーでない理由）と書けます。
理由のない`none`単体、空欄、プレースホルダー理由（`TODO`/`TBD`/`N/A`/`未定`）は
引き続き検証エラーとなり、`none`マーカーがあり理由が使えない場合は
`DES_ADR_EXEMPTION_REASON`として報告されます。
C4-like 図は明示した内容だけを描画し、完全な C4 モデルを推論しません。

正本となるコード・テストに、エンティティごとに1つのコメントを追加します。
JS/TSはparser-awareなcomment位置を使い、Haskellは`--`と`{- ... -}`、
Luaは`--`と`--[[ ... ]]`、Visual Basicは`'''` XML documentを含む
apostrophe commentを扱います。これらは文字列中の記載をリンクとして扱いません。
その他の言語では対応する行commentまたはblock commentを使用します。
Pythonは連続した`#` commentを使用してください。docstring内のannotationは無視され、
`TRACE_ANNOTATION_IN_PYTHON_DOCSTRING`で配置変更を案内します。
PHPでは`/** ... */`のPHPDocではなく素の`/* ... */`を使用してください。PHPDocは
`@implements`をgeneric型宣言に予約しているため、要求IDの列挙はPHPStan/Psalmで
`phpDoc.parseError`になります。musubix3はどちらの形式も読み取ります。
網羅率だけを満たす代理JS/TSファイルは作成しません。

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

複数参照は空白・カンマ区切り。`@design` は任意。
**このdoc commentとnative testレポートのID照合は、`tdd red`/`tdd green`成功のために
両方満たす必要がある、独立した2つの要件です。**`@id TEST-*`/`@verifies REQ-*`
commentは、テストを`kind: 'test'`のtrace-graphノードとして発見可能にし、CLIが
要求へのリンクを解決できるようにするだけです。それとは別に、設定したadapter
（または`tddReport`）が、実行済みのnative testレポート内で同じIDを照合できる
必要があり、その照合方法はadapterごとに異なります（下記のadapter対応表を参照）。
doc commentはあるがレポートをadapterが照合できない場合はRed/Greenが失敗し
（レポートに認識可能な`TEST-*`エントリが無い）、レポートは照合できるがdoc comment
が無い場合はtrace graph参照の時点で`Annotated test ID not found: <id>`で失敗
します。症状は似ていますが原因は異なるため、まずdoc commentを確認し、次に
adapterの照合ルールを確認してください。
実装網羅性は要求への直接リンク、
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
  "qualityProfile": "custom",
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
  "tdd": { "redPreflightCommands": [] },
  "approval": { "mode": "required" },
  "workflow": {
    "mode": "compatible",
    "maxAgeSeconds": 3600,
    "maxFutureSkewSeconds": 60,
    "maxEventSkewMs": 1000,
    "maxTranscriptBytes": 250000000,
    "maxTranscriptLineBytes": 2000000
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
コマンドには任意の`cwd`（project root相対のディレクトリ）を指定でき、
project rootではなくサービス単位のサブディレクトリから実行できます。
polyglot monorepoで、各言語のtoolingが自分のpackage/moduleディレクトリから
実行される前提の場合に有用です。`config lint`はproject rootを脱出する、
または実在しない`cwd`を`CONFIG_CWD_INVALID`として報告し、そのコマンドの
repository相対path引数（`CONFIG_ORPHANED_PATH`）はproject rootではなく
そのコマンド自身の`cwd`を基準にチェックします。
evidence/reportのpath（`tddReport`/`testReport`/`mutationReport`、
`.musubix/config.json`自体）は`cwd`に関わらず常にproject root基準のまま
解決され、変わるのは起動するprocess自体の作業ディレクトリのみです。
`qualityProfile`の既定値は`custom`です。`minimal`はSDDの基本gate、
`recommended`はstrict Code Graph、TDD、構造化test identityも要求し、
`release`はformal、mutation、workflow、変更、performance、CI attestationを
含む完全なrelease checkを要求します。不足設定や弱い設定を証拠で補ったことにはしません。
新規初期化projectの`approval.mode`は`required`で、requirements・design・releaseの
現在の承認を要求します。`approval`を省略した既存schema-v1 configは`compatible`として
読み込みます。`approval prepare`で確認対象のmanifest/hashを表示し、その同じhashを
`approval record`へ渡します。途中変更は拒否され、記録後の対象artifact変更はstaleに
なります。承認fileはstage、approver、`approvedAt`、artifactごとのSHA-256、決定的
manifest SHA-256を保持します。release記録はcache済みquality evidenceを信頼せずgateを
再計算し、承認以外の必須checkがすべてpassした場合だけ成功します。
approver文字列は明示的なlocal証拠であり、認証済みidentityではありません。
独立identityが必要なrepositoryではprotected review、CODEOWNERS、CI/OIDCも併用します。
local承認証拠は明示的な意思を記録しますが、承認者の暗号学的な本人確認ではありません。
release権限はrepository review、CODEOWNERS/branch protection、またはCI/OIDC attestationで
保護してください。
`tdd.redPreflightCommands`にはformatter等のplain command名を指定でき、
Redのtest fingerprintを取得する前に成功が必須です。
通常ファイルの`pyvenv.cfg`を含む`.venv`と`venv`に加え、生成された
`__pycache__/` directoryはsnapshotとCode Graphから除外されます。
sourceなしで実行可能な`.pyc`/`.pyo`単体fileは追跡対象のままです。Gradle `.gradle/`、Dart `.dart_tool/`、
SwiftPM `.build/`、Zig `.zig-cache/`/`zig-out/`、.NET `.dotnet/`は、
親directoryに対応manifestがある場合だけ除外されます。同名の任意source
directoryは追跡対象のままです。
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
Formalポリシー、mutation/approval mode、workflow strict/session/freshness、CI必須attestation、
strict OIDC identity/key binding、必須コマンド名の最低条件です。Red preflightを
要求するbaselineは正規化済み`commands`定義も保持し、同名formatterへの
すり替えを拒否します。弱体化は拒否され、
変更ゲート中のbaseline変更には独立承認が必要です。CODEOWNERS等で保護してください。

**信頼した設定だけを実行してください。** ゲートは環境変数を継承し、シェルを
介さず、時間と出力サイズを制限して実コマンドを動かします。個別の必須コマンドは
集約 `commands` の設定に関係なく失敗・未実行で準備不可になります。
任意コマンドの失敗は非阻止ですが、憲章が失敗件数を制限していれば不合格です。
コマンド未設定は skipped です。構造化test commandはprocessがexit 0でも、
実行testが0件、またはskipped・failed・error testを1件でも報告した場合は
失敗します。integration suiteが依存service不在のまま暗黙に通ることを防ぎます。

**adapterごとのtest-ID宣言方式対応表**（各方式は独立しており、上記の
`@id`/`@verifies` doc commentとの関係は前述の「独立した2つの要件」を参照）:

| Adapter | ID宣言方式 | 具体例 |
| --- | --- | --- |
| `vitest` / `jest` | test titleの任意の位置にIDを部分文字列として含める | `it('TEST-APP-001 rejects empty input', () => { ... })` |
| `pytest` | test関数名のunderscore形式にIDを含める | `def test_TEST_APP_001(): ...` |
| `go-test` | test/subtest名の末尾サフィックスとしてID | `func TestTEST_APP_001(t *testing.T) { ... }` |
| `cargo` | Rust識別子の末尾サフィックスとしてID | `fn test_app_001() { ... }` |
| `junit` | 正確な`@Tag("TEST-APP-001")` **に加えて** IDを含むmethod名または`@DisplayName` | `@Tag("TEST-APP-001") @Test void test() { ... }` |
| `dotnet`（xUnit） | `[Fact(DisplayName = "...")]`内にID | `[Fact(DisplayName = "TEST-APP-001 rejects empty input")]` |

`junit`だけが、IDを含むmethod名/`@DisplayName`に加えて**別途**tag annotationを
要求する方式です。他のadapterはtest自身の名前/titleから直接IDを照合します。

TDD用コマンドには明示的な`tddArgs`と`tddReport`、または組込みの
`vitest`、`jest`、`pytest`、`go-test`、`cargo`、`junit`、`dotnet` adapterが必要です。
明示設定を優先し、adapterは対象引数を導出してnative JSON/JSONL/XMLを正規化します。
`junit` adapterはJava JUnit Platform Console launcherを駆動するものであり、
JUnit XMLを出力するだけのrunner（PHPUnit等）には使えません。その場合は
`tddArgs`/`tddReport`（および`testReport`）を明示設定してください。
custom `musubix-json` reportは
`{"schemaVersion":1,"tests":[{"id":"TEST-APP-001","status":"passed"}]}`形式で、
`status`は`passed`/`failed`/`skipped`/`error`、任意の`"operations":{"counter":12}`が
決定的な性能counterを保持します。
Vitest/Jestの無関係なskipped結果は対象TDDから除外します。pytestにはJSON pluginと
`test_TEST_APP_001`形式、Goには`TEST-*`名のsubtest、Cargoには`test_app_001`形式、
JUnitには正確な`@Tag("TEST-APP-001")`と、IDを含むmethod名または`@DisplayName`を推奨します。
正規化処理はtestcase属性とJUnit Platformのdisplay-name出力の両方を読み取り、
Surefire/Failsafeのtestcase要素は自己終了形でも`<system-out>`/`<system-err>`を
含む形でも解析するため、Spring Bootのbanner等のlog出力で合格IDが欠落しません。
xUnitには`[Fact(DisplayName = "TEST-APP-001 ...")]`が必要です。
それぞれXMLまたはTRX report directoryを読み取ります。各フェーズ前に旧レポートを削除し、
必要なreport親directoryを作成して、対象テストだけを含むfreshな `musubix-json` を要求します。Redは `failed`、
Green/Refactorは `passed` のみ有効で、`skipped`、`error`、未生成、不正形式は失敗です。
Green前にはテスト以外のプロジェクト入力が変更されている必要があります。
異なるテストによる同一フェーズ出力の使い回しは拒否されます。
各フェーズはSHA-256で前レコードと連結した不変レコードとしても追記されます。
TDDと変更checkpointは共通の単調order ledgerを持ち、Red/Green境界ではこれを
正本とし、wall-clock時刻は情報用途に限定します。orderを持たない旧chronologyは
明示的なmigration診断で失敗します。欠落・並べ替え・改変・孤立レコードは
証拠を無効にします。旧cycleは新しい記録では置き換えられません。test scope付き
provenanceや有効なRed/Greenを欠くcycleがある場合は、`.musubix/evidence/tdd.json`を
退避し、全cycleをclean Red baselineから再記録してください。部分的なprune commandは
意図的に提供せず、証拠の手編集は未対応です。

決定的なmutant識別子は`musubix3 mutation identity <REQ-ID> <TEST-ID> <sourcePath>
<operator> <line> <column>`で取得できます。`mutation validate`は
`.musubix/evidence/mutation.json`を読み取り、設定した`mutationReport`はgateがこの
ファイルへ変換するため、gate実行前の検証は「証拠なし」を報告します。

CIではVitest、Jest、
`pytest-json-report`付きpytest、Go test、Cargo test、固定版JUnit Platform Consoleの
各fixtureに無関係な失敗テストを置き、生成selectorが対象IDだけを実行し、実際のnative
reportを正規化できることを検証します。.NET adapterは標準TRXを読み取り、
C#アプリ実験とunit contractで追加検証します。Jestは開発時依存だけであり、Python、
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
Pythonではstaleな`.pyc`によるfalse survivorを防ぐため、`mutation doctor`は
各run前の`__pycache__`削除と、その後の`python -B -m mutmut`および
`python -B -m pytest`を推奨します。

品質根拠は状態、必須フラグ、終了コード・出力、実測値、日時、入力の指紋を保存します。
変更ゲートのパス、HEAD、影響範囲は後続の通常ゲートでも保持します。
`workflow-record` は自己申告のSkill、フェーズ、状態、任意コマンドのSHA-256を保存します。
`workflow-verify` はCopilot JSONLからSkill発火メタデータだけを取り込み、完了宣言ごとに
異なる成功完了tool callを順序付きで1対1対応させます。未完了、失敗、再利用、順序違反、
後からの宣言変更は失敗です。
元transcriptにmessage、Skill以外のtool引数、outputが含まれる場合は、
review evidenceへ入れる前に`workflow-sanitize`で必要最小限へ変換します。
したがって各Skill発火は最終workflow outcomeを1件だけ記録し、複数phaseのchronologyは
重複workflow eventではなく`change-record`に記録します。
`"workflow":{"mode":"strict"}`または`--strict`では、全非空行のJSON、
event timestamp、tool start/completionの1対1整合性、最後に1件だけ存在する
正常終了terminal eventを追加検査します。対応形式は`exitCode: 0`の`result`、
または一意なsession UUIDと、末尾の
`session.shutdown(data.shutdownType="routine")`を持つ現行Copilot CLI形式です。
terminal形式の混在、複数session、異常shutdown、末尾以外のterminal eventは
fail closedで拒否します。terminal `sessionId`、exit code、
event数、terminal時刻、raw source hash、canonical transcript hashを保存します。
`workflow.expectedSessionId`または`--session-id`でcaller申告sessionの置換を拒否します。
strict検証は`workflow.maxAgeSeconds`と`workflow.maxFutureSkewSeconds`で
terminal transcriptの古さと未来方向clock skewも制限します。
並行eventや異なる実行clockのtimestampは単調にならない場合があるため、JSONLの
source順でtool/resultの因果関係を検査し、timestamp sortは行いません。
pair/terminalのclock skewは`maxEventSkewMs`を明示した場合だけ制限し、
terminalの古さ・未来skew policyは独立して検査します。検証はstreamingかつresource-boundで、
既定上限は100,000,000 bytesです。大きな実transcriptには`workflow.maxTranscriptBytes`を
最大1,000,000,000 bytesまで明示設定できます。1 JSONL行は既定1,000,000 bytesで、
`workflow.maxTranscriptLineBytes`により最大10,000,000 bytesまで設定できます。
選択した両上限はpolicy baselineで保護できます。
gate実行中に入力が変わった場合、`input-stability`は追加・変更・削除された各pathと
前後のSHA-256を報告します。Cargo/Mavenの標準`target/`、manifest直下の
.NET `bin/`と`obj/`、project-local `.nuget/packages/`は除外しますが、
source相当の生成入力はfail-closedのままです。コマンドが生成するreportは
追跡対象のsource treeではなく`.musubix/evidence/native/`配下へ出力してください。
gate中に自身のreportを書き込むとinput stabilityが失敗します。組込みadapterは対象test選択とreport引数を
所有します。Cargo/Goの既存設定にある先頭`test`は安全に統合し、
`--json-report`など競合するreport引数は早期拒否します。
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

通常のCLI利用ではEd25519鍵をmusubix3外で生成し、公開PEMだけを
`attestation oidc-audience`へ渡します。
その完全一致audienceでGitHub Actions OIDC tokenを要求し、公開PEMとJWT fileを
`attestation payload`へ渡して、出力payloadを外部で署名します。`musubix3` CLIは
秘密鍵を受け取らず、読み取りも保存もしません。このrepositoryのrelease専用automationは
別途ephemeral private keyを無視対象の`.test-work`内に生成して署名へ使用し、
CLI検証を呼び出す前に削除します。短命JWTは署名済みattestationに含まれ、現在時刻で期限を
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
  bundler 独自解決とリフレクションは対象外です。Rust、Python、Go、Java、
  Kotlin、C/C++、Objective-C/Objective-C++、C#、F#、Visual Basic .NET、
  Ruby、PHP、Swift、Dart、Scala、Elixir、Haskell、Lua、Zig、Solidity、R、
  Juliaはローカルimport/module/include/source、宣言、直接呼び出しを
  保守的に解析します。その他の拡張子はグラフ入力に含めません。他言語用の
  代理 JS/TS ファイルは作成しません。
  build/cache/dependency と symlink は除外しますが、任意の `.gitignore` は
  スキャンフィルターとして読みません。
- 残るarchitecture改善には、実測根拠を伴うstrict call-resolution ratio policyと、
  より広いnative test-runner adapter対応があります。このreleaseでは推測的に
  有効化しません。
- 検索は **TF-IDF/cosine** であり GraphRAG でも意味推論でもありません。
  日本語は文字 bigram。Git 根拠は最大100コミット・各30ファイルで、共変更は相関、
  著者別ディレクトリ件数は貢献の記録であって因果や専門性ではありません。
  履歴がない場合は明示的に skipped。外部サービスへは送信しません。
- Core CIはNode 22をLinux、Windows、macOSで実行し、LinuxではNode 20と
  Node 24の互換性も追加確認します。native adapterとformal solverの統合は、
  固定toolchainを使ってLinuxで実行します。
  Windowsの実行ラッパーとprocess tree停止にはplatform固有の差があります。
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
CLI、モジュール、雛形が明示的に含まれます。Core CIはNode 22をLinux、Windows、
macOSで実行し、LinuxではNode 20/24の互換性も検証します。native adapterと
formal solverは固定toolchainを使ってLinuxで統合検証します。
`pack:smoke` は実際のtarballを `.test-work/` 内の独立した利用側プロジェクトへ
導入し、実行ファイル・ESM export・配置を確認してから削除します。
attestation APIは`musubix3/analysis`と専用`musubix3/attestation` exportの
両方から利用できます。

`v*` tagは`.github/workflows/release.yml`を起動します。workflowはtagと
package/plugin versionの一致を検証し、Linux上のnative/formal suiteを実行して、
npm tarball、CycloneDX SBOM、SHA256SUMS、GitHub Releaseを生成します。
`npm publish --provenance --access public`は保護された`npm-publish` environmentで
別途承認されます。npm Trusted Publishingを優先し、任意の`NPM_TOKEN` environment
secretも利用できます。npm publishがpendingまたは失敗してもGitHub Release作成結果を
成功に見せかけず、各jobの状態を独立して確認できます。手動実行ではrelease tagを
workflow refとして選び、同じ値を`release_tag`へ指定します。tagがOIDCに束縛された
`GITHUB_SHA`を指していなければworkflowは拒否します。

release attestationは、ephemeral Ed25519公開鍵をcustom audienceへ束縛した
GitHub Actions OIDC tokenを使用します。署名対象にはrepository、Git commit、
run ID、workflow/ref identity、workspace snapshot、存在するmusubix evidence headが
含まれます。release automationは`.test-work`内のprivate keyで署名した後、
CLI検証前に削除し、署名済みattestationだけをuploadします。署名だけでtest semanticsが
正しいとは主張せず、testとsolverは先行するrelease validation jobで検査します。

[CONTRIBUTING.md](CONTRIBUTING.md) と [CHANGELOG.md](CHANGELOG.md) も参照してください。
