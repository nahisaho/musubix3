---
title: "GitHub Copilot CLI × musubix3で23言語のアプリを作り、仕様・TDD・形式検査・証拠ゲートまで通してみた"
tags:
  - GitHubCopilot
  - TDD
  - TypeScript
  - Rust
  - Java
private: false
updated_at: "2026-09-07"
id: null
organization_url_name: null
slide: false
ignorePublish: false
---

# はじめに

GitHub Copilot CLIに「アプリを作って」と依頼すると、コードとテストはかなり速く生成できます。
しかし、実務で本当に難しいのは生成そのものより、次の問いへ再現可能に答えることです。

- そのコードは、どの要求を実装しているのか
- 要求変更は、設計・コード・テストへ正しい順序で伝播したのか
- TDDのRedは本当に失敗し、Greenは同じテストで成功したのか
- 「テスト済み」は、実際のテストランナーの結果に基づくのか
- 形式モデルがSATなら、実装まで正しいと言ってよいのか
- 証拠ファイルを後から書き換えていないか
- 大きな変更の途中で古くなった証拠を、誤って再利用していないか

この問題に対して、[musubix3](https://github.com/nahisaho/musubix3)は
GitHub Copilot CLI用の8つのSkillsと、決定的な検証CLIを提供します。

本記事では、実際に独立した5つのアプリケーションを作りました。

1. TypeScript: Task Timer
2. Python: FastAPI Reservation API
3. Go: URL Shortener
4. Rust: Event-driven Inventory Processor
5. Java 21: Multi-module Order Fulfillment Platform

さらにv0.1.3開発では、Code Graph対応を23言語グループへ拡張し、
全言語で中規模・大規模アプリケーションを順次開発して再検証しました。
最終的な大規模検証は23/23アプリが`gate=pass`、`ready=true`です。

小規模CLIから複数モジュールの業務システムまで段階的に規模を上げ、
要求、設計、ADR、TDD、トレース、Code Graph、形式的整合性、
mutation evidence、performance counter、workflow transcript、
attestationまで試しています。

> 初回実験、公開版v0.1.1での再実験、リリース前v0.1.2での改善確認は
> 2026年9月7日に実施しました。
> 実験レポートは
> `/tmp/work-v011/01-task-timer/EXPERIMENT.md` から
> `/tmp/work-v011/05-order-platform/EXPERIMENT.md` に生成しました。
> v0.1.2の比較環境は`/tmp/work-v012`です。
> 記事の手順を読み直して行った最終再実験は
> `/tmp/work-v012-article`へ分離しました。
> どちらも一時領域であり、このmusubix3リポジトリへコミットした成果物ではありません。
> 再起動やクリーンアップで消える前提です。

---

# 先に結論

musubix3を一言で表すと、
**Copilotに実装を任せつつ、「完了」の条件を仕様と機械検証可能な証拠で狭めるツール**
です。

良かった点は明確でした。

- EARS要求、設計、ADR、コード、テストをIDで接続できる
- Red/Greenをテストランナーの構造化レポートで確認できる
- テストや実装のfingerprintが変わると、古い証拠を拒否できる
- 要求変更の順序を単調なledgerで検査できる
- TypeScript以外のPython、Go、Rust、Javaでも追跡とテストadapterが使える
- Z3/Leanの不在やエラーを「成功したこと」にしない
- 形式モデルと、実際に成功したテストの対応を別に確認できる
- 大規模なCopilot JSONL transcriptを上限付きstreamingで検証できる
- `evidence refresh`で証拠再生成と品質ゲートを明示的に再実行できる
- Cargo/Goの既存引数、multi-module JUnit XML、Cargo/Mavenの`target/`を
  実プロジェクト構成のまま扱える
- input-stability違反時にpathと変更前後のSHA-256を確認できる

一方、コストもあります。

- 要求文は自由作文ではなく、制御されたEARS形式へ合わせる必要がある
- TEST ID、コード注釈、構造化レポート、設定ファイルの整合が必要
- ソースを少し変えただけでもtraceやgateの再生成が必要になる
- Mavenやpytestなど、各テストランナー固有のreport形式に慣れが要る
- SATは実装証明ではないため、形式検査だけで安心してはいけない
- ローカル実験だけではGitHub Actions OIDCの信頼連鎖を完全再現できない

つまり、短い試作では重く感じることがあります。
しかし、変更理由と完了根拠を残したい中〜大規模開発では、その厳しさ自体が価値になります。

---

# musubix3とは何か、何ではないか

## musubix3が行うこと

musubix3は、仕様駆動開発（SDD）の成果物と実行証拠を検査します。

```text
要求
  ↓
設計・ADR
  ↓
コード・テスト
  ↓
トレース / Code Graph
  ↓
形式モデル / TDD / mutation / performance
  ↓
品質ゲート / provenance
```

主な責務は次の通りです。

- EARS形式の要求を構文検査する
- 測定可能な憲章ルールを検査する
- 設計要素とADR参照を検査する
- 要求・設計・コード・テストの型付きトレースを構築する
- コンパイラまたは言語別adapterで依存グラフを構築する
- 実テストのRed/Green/Refactor証拠を記録する
- Formal JSONからSMT-LIB2/Lean入力を生成する
- Z3/Leanの実行状態をfail-closedで扱う
- 形式モデルから成功テストまでの対応を検査する
- mutation/performance/workflow/attestationの証拠を再検証する
- 最後に`gate`でリリース準備状態を決定する

## musubix3が行わないこと

誤解しやすいので、先に境界を明記します。

musubix3は次のものではありません。

- 独自LLM
- 独自Agent runtime
- 汎用コードジェネレーター
- 汎用テストジェネレーター
- MCP server
- 常駐watcher
- REPL
- 汎用SAST
- 自然言語を完全理解する形式証明器
- SAT判定だけで実装の正しさを保証するツール

計画、編集、調査、レビュー、security review、subagentは
GitHub Copilot CLIのネイティブ機能へ委譲します。
musubix3は、その作業を仕様と証拠で制約します。

musubix2との違いは
[musubix2からmusubix3で変わったこと](MUSUBIX2-TO-MUSUBIX3.md)
に詳しくまとまっています。

---

# 実験方法

各アプリは別々のGitリポジトリとして作り、先にmusubix3を導入しました。
その後、リポジトリローカルのSkillsを使うようCopilotへ明示し、
非対話autopilotで開発させました。

実験では、次の原則を共通にしました。

1. 生成されたexample要求・設計を、そのまま完成扱いしない
2. 実際のアプリ要求へ置き換える
3. 実装より先に要求と設計を検証する
4. 代表的なmust要求は実際のRedから開始する
5. TEST IDをテストランナーの結果へ残す
6. 実装後にtraceとgraphを再生成する
7. Formal JSONを使う場合はmodel correspondenceも確認する
8. optionalな証拠を実施していない場合、成功と表現しない
9. gateのために要求やpolicyを弱めない
10. 失敗を修正し、再実行して収束させる

## 5アプリの進行表

| 段階 | アプリ | 規模 | 言語・主要技術 | 目的 | テスト | 主に試したmusubix3機能 | 最終判定 |
|---:|---|---|---|---|---|---|---|
| 1 | Task Timer | 小 | TypeScript / Node.js / Vitest | 時刻・永続化境界を持つCLI | 7件成功 | EARS、Vitest TDD、trace、graph、単一タイマー形式モデル | gate成功、ready=true |
| 2 | Reservation API | 小〜中 | Python 3.12 / FastAPI / Pydantic / pytest / httpx | 容量・時間重複・冪等性 | 9件成功 | pytest adapter、時間制約、Z3、knowledge | gate成功、ready=true |
| 3 | URL Shortener | 中 | Go 1.22 / net/http | 期限、統計、rate limit、原子的JSON保存 | 要求対応9件成功 | Go adapter、変更履歴、決定的performance counter | gate成功、ready=true |
| 4 | Inventory Processor | 中〜大 | Rust / serde | event log、replay、snapshot、在庫不変条件 | 17件成功、構造化ID 13/13 | Cargo adapter、strict graph、Z3、Lean生成物、変更chronology | gate成功、ready=true |
| 5 | Order Fulfillment Platform | 大 | Java 21 / Maven / JUnit 5 / HttpServer | 複数境界・補償・監査・運用指標 | 9件成功 | multi-module graph、再帰JUnit adapter、late change | gate成功、ready=true |

ここで「実用範囲」と書いたのは、ローカル環境では
GitHub Actions OIDCによるCI identityを完全には再現していないためです。
テスト件数は各runnerの最終結果から取得しました。
数を増やすことより、要求に結び付いたauthoritative testと
実際の成功reportが新鮮であることを優先しました。

## 公開版v0.1.1での再実験

初回記事作成後、ローカルtarballではなくnpmへ公開されたexact versionを
5リポジトリへ導入し直しました。

```bash
npm install --save-dev --save-exact musubix3@0.1.1
npx --no-install musubix3 --version
# 0.1.1
```

各`package-lock.json`の`resolved`が
`https://registry.npmjs.org/musubix3/-/musubix3-0.1.1.tgz`
であることも確認しました。その後、各言語のtest/buildと次を実行しました。

```bash
npx --no-install musubix3 evidence refresh --changed --json
npx --no-install musubix3 gate --changed --json
npx --no-install musubix3 status --json
```

5件すべてでgateは`pass`、`status.gate.ready`は`true`でした。
この再実験では、v0.1.1で追加・修正した次の動作も確認しました。

- Cargoの先頭`test`と`--`を重複させず、harness引数を維持する
- Goのvalue-bearing flag、package selector、`-args`を壊さない
- pytestのadapter所有report flagを重複指定すると早期に拒否する
- Cargo/Maven project直下の`target/`だけをbuild outputとして除外する
- multi-module配下のJUnit XMLを再帰的に探索する
- input-stability違反をpathと変更前後SHA-256付きで報告する
- `formal doctor`に試行したcommandと具体的な推奨対応を表示する

stale evidence、Green後に変更したtest、未導入Lean、
未承認policy baseline変更を成功扱いしないことも維持されました。

---

# 最終的に確認した環境

実験終了時に確認した主要バージョンは次の通りです。

| ツール | 確認値 |
|---|---|
| OS系統 | Ubuntu / WSL系Linux |
| Node.js | `v22.22.1` |
| npm | `11.18.0` |
| Git | `2.43.0` |
| curl | `8.5.0` |
| unzip | `6.00` |
| zstd | `1.5.5` |
| Python | `3.12.3` |
| Go | `go1.22.2 linux/amd64` |
| rustc | `1.91.1` |
| cargo | `1.91.1` |
| Java | OpenJDK `21.0.11` |
| Maven | `3.9.6` |
| Z3 | `5.1.0` |
| GitHub Copilot CLI | `1.0.84-1` |
| Lean | 直接の`lean`コマンドは最終shellのPATHでは未検出 |

バージョン確認には次を使えます。

```bash
git --version
curl --version | head -n 1
unzip -v | head -n 1
zstd --version

node --version
npm --version
copilot --version

python3 --version
go version
rustc --version
cargo --version
java -version
mvn --version
z3 --version
lean --version
```

> 上表は今回の最終検証機で実測した値です。
> 以下のインストール手順はUbuntu/WSL向けの例であり、
> Ubuntuのリリース、企業proxy、CPU architecture、既存toolchainによって変わります。

---

# fresh Ubuntu / WSLからの準備

## 1. 基本パッケージ

```bash
sudo apt update
sudo apt install -y \
  ca-certificates \
  git \
  curl \
  unzip \
  zstd \
  build-essential \
  pkg-config \
  libssl-dev
```

`zstd`は常に必須というわけではありません。
配布物やtoolchain archiveがZstandard圧縮の場合に必要になります。

## 2. Node.js 20以上とnpm

musubix3の`engines`は`node >=20`です。
今回の最終環境はNode.js 22でした。

Ubuntu標準repositoryのNode.jsが古い場合、
NodeSource、nvm、asdf、miseなどから1つを選びます。
以下はNodeSourceを使うOS依存の例です。

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o nodesource_setup.sh
less nodesource_setup.sh
sudo -E bash nodesource_setup.sh
rm nodesource_setup.sh
sudo apt install -y nodejs
node --version
npm --version
```

セキュリティ上、`curl ... | sudo bash`を無条件で実行しない方が安全です。
一度ファイルへ保存し、配布元、TLS、内容を確認してから実行してください。
組織管理端末では、社内mirrorや承認済みversion managerを優先します。

## 3. GitHub Copilot CLI

今回使ったCLIは旧`gh copilot` extensionではなく、
`copilot`コマンドとして動作するGitHub Copilot CLIです。

```bash
npm install -g @github/copilot
copilot --version
copilot login --device-code
```

デスクトップ環境では次でも構いません。

```bash
copilot login
```

ログイン後、GitHub側の組織policyとCopilot利用権限も確認します。

tokenを自動化で渡す場合は、CLIが対応する
`COPILOT_GITHUB_TOKEN`、`GH_TOKEN`、`GITHUB_TOKEN`を使えます。
ただし、次を守ってください。

- tokenをpromptへ貼らない
- JSONL transcriptへ秘密を出さない
- shell historyへ直接残さない
- classic PATではなく、対応するfine-grained token等を使う
- 必要最小権限にする
- `--secret-env-vars`によるredactionも検討する

## 4. Python 3.12、venv、pip

```bash
sudo apt install -y python3.12 python3.12-venv python3-pip
python3.12 --version

python3.12 -m venv ../.venv-my-app
ln -s ../.venv-my-app .venv
source ../.venv-my-app/bin/activate
python -m pip install --upgrade pip
```

Ubuntuのreleaseによっては`python3.12`が標準repositoryにありません。
その場合はdeadsnakes PPA等を安易に追加する前に、
組織の配布方針、pyenv、コンテナ利用を確認してください。

Reservation APIでは、venv内にFastAPI、Pydantic、pytest、httpxと、
musubix3のpytest adapterが要求する`pytest-json-report`を導入しました。

再実験では、repository直下へ通常directoryの`.venv/`を作ると、
Python Code Graphがsite-packagesまでindexし、依存package内部のcycleを
projectのcycleとして報告しました。`.gitignore`だけに依存せず、
virtualenv本体をrepository外へ置くか、無視対象directory内に置いて
`.venv`をsymlinkにする構成が安全です。

```bash
python -m pip install \
  fastapi \
  pydantic \
  pytest \
  pytest-json-report \
  httpx
```

## 5. Go 1.22

Ubuntu packageで要件を満たす場合の例です。

```bash
sudo apt install -y golang-go
go version
```

標準repositoryが古い場合は、
[go.devの公式配布](https://go.dev/dl/)を使います。
archiveのSHA-256を公式値と照合してから展開してください。

## 6. RustとCargo

Ubuntu packageを使う例:

```bash
sudo apt install -y rustc cargo
rustc --version
cargo --version
```

rustupを使う場合は、公式installerを保存・確認してから実行し、
toolchainを固定します。

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o rustup-init.sh
less rustup-init.sh
sh rustup-init.sh
rm rustup-init.sh
rustup toolchain install stable
rustup default stable
```

## 7. Java 21とMaven

```bash
sudo apt install -y openjdk-21-jdk maven
java -version
mvn --version
```

`JAVA_HOME`が必要な環境では、実体を確認して設定します。

```bash
readlink -f "$(command -v java)"
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
```

architectureによってpathは変わります。
値をコピーせず、必ず自分の環境で確認してください。

## 8. Z3

```bash
sudo apt install -y z3
z3 --version
```

今回の最終環境ではZ3 5.1.0を確認しました。
musubix3は、明示的に`--solver z3`を指定したのにZ3が無い場合、
成功へfallbackしません。

## 9. Leanは任意

Leanは必須ではありません。
ただし`--solver lean`を明示した検査や、Lean生成物を実行したい場合は必要です。

一般にはelanで導入します。

```bash
curl -fsSL https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh \
  -o elan-init.sh
less elan-init.sh
sh elan-init.sh
rm elan-init.sh

source "$HOME/.elan/env"
lean --version
lake --version
```

musubix3は`lean`だけでなく`lake env lean`も検出対象にします。
今回のRust実験ではLeanソースの生成まで確認しましたが、
ローカルに`lake`がなく、Lean実行は`missing`でした。
したがってLean検査成功とは扱っていません。

最初に必ずdoctorを実行します。

```bash
npx --no-install musubix3 formal doctor --json
```

---

# musubix3 0.1.2の導入

## npxで一度試す

対象プロジェクトのrootで実行します。

```bash
npx musubix3@0.1.2 --version
npx musubix3@0.1.2 init --dry-run
npx musubix3@0.1.2 init
```

`init --dry-run`を先に実行するのが重要です。
既存ファイルを`create`、`preserve`、`unchanged`、`merge`のどれとして扱うかを確認できます。

## exact devDependencyとして固定する

再現性を優先するなら、こちらを推奨します。

```bash
npm install --save-dev --save-exact musubix3@0.1.2
npx --no-install musubix3 --version
npx --no-install musubix3 init --dry-run
npx --no-install musubix3 init
```

`--save-exact`により`package.json`へ`0.1.2`を固定します。
以降の例では、意図しないnetwork取得を避けるため
`npx --no-install musubix3`を使います。

## 生成される主なファイル

```text
.github/
└── skills/
    ├── sdd-change/SKILL.md
    ├── sdd-requirements/SKILL.md
    ├── sdd-design/SKILL.md
    ├── sdd-implementation/SKILL.md
    ├── sdd-traceability/SKILL.md
    ├── sdd-quality/SKILL.md
    ├── sdd-knowledge/SKILL.md
    └── sdd-formal-codegraph/SKILL.md

.musubix/
├── config.json
├── policy-baseline.json
├── constitution.md
├── decisions/
│   └── ADR-0001.md
├── features/
│   └── example/
│       ├── requirements.md
│       ├── design.md
│       └── trace.json
├── evidence/
│   └── quality.json
└── cache/
```

さらに`.gitignore`へ次がmergeされます。

```gitignore
# musubix3 generated caches
/.musubix/cache/
```

`init`は既存ファイルを原則保持し、`--force`でも管理対象pathだけを置換します。
プロジェクト外への書き込みとsymbolic link write targetは拒否されます。

## Copilot CLIはSkillsをどう見つけるか

GitHub Copilot CLIは、信頼した作業directoryの
`.github/skills/<skill-name>/SKILL.md`をrepository-local Skillとして読み込みます。

確認にはinteractive sessionで次を使えます。

```text
/skills
/env
```

別directoryを追加する場合は`--add-dir`または`/add-dir`がありますが、
今回の実験では各アプリ自身へ`init`し、
repository-local Skillsとして発見させました。

同じSkill名をpluginとrepository-localの両方から読み込むと混乱するため、
導入経路は1つに揃えるのが安全です。

---

# 今回使った非対話Copilot CLIパターン

実験では、次の形でCopilot CLIを起動しました。

```bash
set -o pipefail

copilot \
  --allow-all \
  --autopilot \
  --max-autopilot-continues 20 \
  --output-format=json \
  -p "<実験プロンプト>" \
  | tee copilot.jsonl
```

重要なのは、次の5点です。

1. `-p`で非対話promptを渡す
2. `--autopilot`で継続実行させる
3. `--max-autopilot-continues`で無制限継続を避ける
4. `--output-format=json`でJSONL transcriptを得る
5. `pipefail`で、`tee`が成功してもCopilot側の失敗を見逃さない

今回の起動では継続上限を20に固定しました。
これは「必ず20回継続する」という意味ではなく、autopilotが自律継続できる上限です。

`--output-format=json`は単一JSONではありません。
**1行1JSON objectのJSONL**です。
全文を記事へ貼らず、必要なSkill invocation metadataとterminal resultを
`workflow-verify`へ渡します。

```bash
npx --no-install musubix3 \
  workflow-verify copilot.jsonl \
  --strict \
  --session-id "<terminal resultのsessionId>"
```

## `--allow-all`は便利だが強い権限

`--allow-all`は、tool、path、URLの許可をまとめて広げます。
信頼していないrepository、第三者のprompt、未確認の設定では使うべきではありません。

安全側の選択肢は次です。

- interactive modeで個別承認する
- `--allow-tool`で必要なtoolだけ許可する
- `--allow-url`でdomainを限定する
- `--disallow-temp-dir`を使う
- secretをenvironmentから除外・redactする
- containerや使い捨てVMで実行する
- 実行前に`.github/skills`、instructions、MCP設定をreviewする

本記事の非対話実行は、隔離した実験用repositoryで再現性を得るための選択です。
普段の開発では、interactive approvalの方が適切な読者も多いはずです。

---

# 8つのSkillsと、実験で発火した場面

| Skill | 役割 | 今回の典型的な発火場面 |
|---|---|---|
| `sdd-change` | 変更全体の統合 | 新規アプリ開始、Rustの予約期限追加、Javaの手動承認追加 |
| `sdd-requirements` | EARS要求と憲章 | example要求を実要件へ置換、Acceptance/Formal/Performance追加 |
| `sdd-design` | コンポーネント、interface、制約、ADR | Clock/Repository port、event store、ports/adapters、multi-module境界 |
| `sdd-implementation` | 実装、テスト、注釈、runner adapter | Red→最小実装→Green、`@implements`/`@verifies`追加 |
| `sdd-traceability` | trace構築、strict coverage、impact | ID誤りの修正、late changeの影響経路確認 |
| `sdd-quality` | 実コマンドと最終gate | test/build/typecheck、freshness、policy baseline、status |
| `sdd-knowledge` | ローカル成果物とGitの決定的検索 | ADRや過去要求の再発見、変更前の判断根拠確認 |
| `sdd-formal-codegraph` | Formalと依存グラフ | 在庫非負、単一timer、容量制約、rate limit、module依存 |

Skillsは別のAIを起動するものではありません。
各`SKILL.md`がCopilotへ手順、境界、必要証拠、終了条件を指示し、
最終的な機械判定は`musubix3` CLIが行います。

各Skill invocationでは、原則として最後に1回だけ結果を記録します。

```bash
npx --no-install musubix3 \
  workflow-record sdd-requirements complete --status completed
```

同じinvocationで複数の完了eventを記録すると、
transcriptとの1対1対応が崩れるため注意が必要です。

---

# musubix3の最適化TDD

## TEST IDを中心にする

テスト名またはrunner reportへ、要求に対応するTEST IDを含めます。

TypeScriptの例:

```ts
/** @id TEST-TASK-TIMER-003
 * @verifies REQ-TASK-TIMER-003
 */
it("TEST-TASK-TIMER-003 rejects a second active timer", async () => {
  // behavior assertion
});
```

Pythonではunderscore形式、Goではsubtest名、CargoではRust identifier、
JUnitでは正確な`@Tag`が必要です。

```python
def test_TEST_RESERVATION_API_003_rejects_over_capacity():
    ...
```

```go
t.Run("TEST-URL-SHORTENER-007", func(t *testing.T) {
    // ...
})
```

```rust
#[test]
fn test_inventory_006_rejects_negative_available_stock() {
    // ...
}
```

```java
@Test
@Tag("TEST-ORDER-014")
void test_TEST_ORDER_014_requires_manual_approval() {
    // ...
}
```

## Red

```bash
npx --no-install musubix3 \
  tdd red TEST-FEATURE-001 \
  --requirement REQ-FEATURE-001 \
  --command test
```

Redとして認められるには、少なくとも次が必要です。

- 対象TEST IDだけを選んだfresh report
- test statusが`failed`
- process exitがnonzero
- annotated testが要求を`@verifies`
- reportがmalformedでない

単に`exit 1`するscriptは、正しいRed証拠になりません。

## Green

テストを変更せず、非テストsourceを変更してから実行します。

```bash
npx --no-install musubix3 \
  tdd green TEST-FEATURE-001 \
  --requirement REQ-FEATURE-001 \
  --command test
```

Greenでは次を確認します。

- 同じ要求、TEST ID、commandである
- Red後にテストfingerprintが変わっていない
- 非テストsource fingerprintが変わっている
- report statusが`passed`
- process exitが0

## Refactor

```bash
npx --no-install musubix3 \
  tdd refactor TEST-FEATURE-001 \
  --requirement REQ-FEATURE-001 \
  --command test
```

RefactorはGreen後だけ記録できます。

## structured report、fingerprint、hash chain

`.musubix/evidence/tdd.json`には、概念的に次が残ります。

- command hash
- output hash
- report hash
- test fingerprint
- source fingerprint
- exit code
- duration
- phase
- monotonic order
- previous record hash
- current record hash

各phaseはSHA-256で連鎖します。
途中のrecordを変更すると、その後のchainと一致しません。

さらに`.musubix/evidence/order.json`は、
TDDと`change-record`で共通の単調な順序を持ちます。
wall clockは表示情報に過ぎず、
「要求変更後にRedがあり、実装後にGreenがあるか」はledgerで判断されます。

---

# 実験1: TypeScript Task Timer

## 要求

最初は小さなNode.js CLIです。

- taskを追加する
- 1つのtaskだけtimerを開始できる
- active timerを停止する
- task一覧を表示する
- 日次reportを決定的に生成する
- JSONへ永続化する
- 2つ目のactive timer開始を拒否する
- 時刻とstorageをtestで差し替え可能にする

## architecture

小規模でも、時刻とI/Oをdomain logicから分離しました。

```text
CLI
 ↓
TaskTimerService
 ├── Clock port
 └── TaskRepository port
      └── JsonTaskRepository
```

代表的な境界は次のような形です。

```ts
export interface Clock {
  now(): Date;
}

export interface TaskRepository {
  load(): Promise<TaskState>;
  save(state: TaskState): Promise<void>;
}
```

この分離により、日付境界と経過時間をwall clockへ依存せず検証できます。

## Copilotへ与えた要点

```text
sdd-changeを使い、Task Timerを要求、設計、TDD、trace、graph、
formal、qualityまで一貫して実装する。
strict TypeScriptとVitestを使い、ClockとStorageを注入する。
同時にactiveなtimerは1つだけという不変条件を検査する。
```

ここでは8 Skillsのうち、特に次が強く働きました。

- `sdd-requirements`: 6〜8件の測定可能なEARS要求
- `sdd-design`: Clock/Repository境界とADR
- `sdd-implementation`: VitestのRed/Green
- `sdd-traceability`: 要求からtestまでのcoverage
- `sdd-formal-codegraph`: active timer不変条件
- `sdd-quality`: typecheck、test、gate

## 開発コマンド

```bash
npm install
npm test
npm run typecheck

npx --no-install musubix3 requirements validate \
  .musubix/features/task-timer/requirements.md --json
npx --no-install musubix3 design validate \
  .musubix/features/task-timer/design.md --json
npx --no-install musubix3 trace build --json
npx --no-install musubix3 trace check --strict --json
npx --no-install musubix3 graph index --json
npx --no-install musubix3 formal check \
  .musubix/features/task-timer/requirements.md \
  --solver z3 --json
npx --no-install musubix3 gate --changed --json
```

## 失敗と修正

最初につまずいたのは、EARSを「意味が通る自然文」として書けばよい、
と考えてしまう点でした。
musubix3は制御構文を検査するため、語順やrequired fieldが不正だと拒否します。

修正方針は、要求を曖昧に緩めるのではなく、
1つの要求へ1つのobligationを置き、
`Statement`と`Acceptance`を分けることでした。

次に、trace annotationのIDが要求ファイルのIDと一致せず、
strict traceでdanglingとなるケースがありました。
文字列を似せるのではなく、正本IDへ統一して`trace build`をやり直しました。

Vitest report adapterでは、対象TEST IDだけを選べるtest名が必要です。
一般的な日本語名だけにせず、test名へ`TEST-TASK-TIMER-*`を含めて解決しました。

## 結果と限界

- add/start/stop/list/reportのbehavior testが成功
- 2つ目のactive timer拒否を確認
- fake clockにより日次reportを決定的に確認
- JSON repositoryを実ファイル境界として分離
- strict traceとCode Graphを実行
- 単一active timerの抽象モデルをZ3で整合性確認
- 公開版v0.1.1でgate `pass`、ready `true`

ただし、SATは排他制御実装の完全証明ではありません。
実装上のraceやfilesystem障害は、テストとreviewで別に扱う必要があります。

---

# 実験2: Python FastAPI Reservation API

## 要求

2つ目は時間区間と容量を扱うREST APIです。

- resourceとcapacityを作成する
- reservationを作成する
- reservationをcancelする
- 同じ時間帯の合計がcapacityを超える予約を拒否する
- idempotency keyで重複作成を防ぐ
- 指定時間帯のavailabilityを返す
- health endpointを返す
- in-memory repositoryをinterfaceの背後へ置く

## architecture

```text
FastAPI routes
  ↓
ReservationService
  ├── ResourceRepository
  ├── ReservationRepository
  ├── IdempotencyRepository
  └── Clock
```

Pydantic modelはHTTP境界のvalidationを担当し、
容量とoverlap判定はapplication/domain serviceへ置きました。

時間帯の重複は、半開区間として扱うと境界条件が明確になります。

```python
def overlaps(a_start, a_end, b_start, b_end):
    return a_start < b_end and b_start < a_end
```

この短い式でも、capacity集計、cancel済み予約の除外、
timezoneの扱いまで含めるとtest caseは増えます。

## promptとSkills

```text
sdd-changeを使い、FastAPI/Pydantic/pytest/httpxで予約APIを構築する。
容量超過、時間重複、idempotencyを測定可能な要求にし、
pytest JSON reportで代表的must要求のRed/Greenを記録する。
capacityとtemporal constraintをFormal JSONへ記述する。
```

`sdd-knowledge`では、要求とADRをindexし、
「capacity」「idempotency」「overlap」に関連するlocal evidenceを検索しました。
これはembedding検索ではなく、TF-IDF/cosineの決定的なランキングです。

## pytest adapter

pytestでは`pytest-json-report`が必要です。

```bash
python -m pytest -q

npx --no-install musubix3 \
  tdd red TEST-RESERVATION-API-003 \
  --requirement REQ-RESERVATION-API-003 \
  --command test
```

test function名にはunderscore形式のIDを入れます。

```python
def test_TEST_RESERVATION_API_003_rejects_over_capacity():
    ...
```

## 失敗と修正

### report adapter

初期設定ではpytest自体は成功しても、
musubix3が期待するfresh JSON reportを見つけられないことがありました。

修正点:

- `pytest-json-report`をvenvへ追加
- commandのworking directoryをrepository rootへ統一
- report pathを`.musubix/cache`配下へ統一
- TEST IDを関数名へ含める
- stale reportを残さず毎回生成する

### Formal JSON schema

自然言語のcapacity制約をそのままJSONへ写すのではなく、
musubix3が受理する`numeric`、`temporal`、`conditional`へ分けました。
存在しないfield名や文字列の数値はschema errorになります。

### stale evidence

API modelやtest annotationを直した後、
以前のtrace/gate evidenceは古くなります。
修正後は次の順で再構築しました。

```bash
npx --no-install musubix3 trace build
npx --no-install musubix3 graph index
npx --no-install musubix3 gate --changed --json
```

## 結果と限界

- FastAPI endpointのfull pytest suiteが成功
- capacity超過とoverlap境界を検査
- idempotency keyの再送で重複作成しないことを確認
- trace/graph/knowledge/formalを実行
- Z3でモデル化した部分の整合性を確認
- 公開版v0.1.1でgate `pass`、ready `true`

in-memory repositoryなので、
複数process、分散transaction、database isolationは対象外です。
この実験はAPI contractとdomain ruleの検証であり、
本番databaseの一貫性証明ではありません。

---

# 実験3: Go URL Shortener

## 要求

3つ目は標準library中心のHTTP serviceです。

- URLを登録してshort aliasを発行する
- alias generationをinterfaceの背後へ置く
- redirectする
- expirationを扱う
- URLを削除する
- click statisticsを記録する
- client単位でrate limitする
- JSONをatomic writeする
- graceful shutdownする

## architecture

```text
net/http Handler
  ↓
Shortener Service
  ├── AliasGenerator
  ├── Clock
  ├── RateLimiter
  └── Store
       └── Atomic JSON File Store
```

deterministic alias generatorを注入することで、
testでaliasの期待値を固定できます。

atomic writeは概念的に次の順です。

```go
// 1. 同じdirectoryへ一時ファイルを書く
// 2. flush/closeする
// 3. renameで正本へ置き換える
```

同じfilesystem内のrenameを使うこと、
途中失敗時に正本を壊さないことが重要です。

## table-driven testとTEST ID

```go
func TestCreate(t *testing.T) {
    cases := []struct {
        name string
        // input / expected
    }{
        {name: "TEST-URL-SHORTENER-001"},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            // ...
        })
    }
}
```

実行:

```bash
go test ./...

npx --no-install musubix3 \
  tdd red TEST-URL-SHORTENER-001 \
  --requirement REQ-URL-SHORTENER-001 \
  --command go-native

npx --no-install musubix3 \
  tdd green TEST-URL-SHORTENER-001 \
  --requirement REQ-URL-SHORTENER-001 \
  --command go-native
```

## 決定的performance counter

rate limitや検索処理のbudgetを、
wall-clock millisecondだけで判定しないようにしました。

要求側:

```text
Performance: {"counter":"aliasLookups","max":1,"testId":"TEST-URL-SHORTENER-005"}
```

structured report側:

```json
{
  "schemaVersion": 1,
  "tests": [
    {
      "id": "TEST-URL-SHORTENER-005",
      "status": "passed",
      "operations": {
        "aliasLookups": 1
      }
    }
  ]
}
```

`Store.Stats`が実測したalias lookup回数をreportへ出力し、
要求上限1以下であることを検査しました。

## 失敗と修正

- trace IDのprefix不一致を修正
- Go subtest名へ正確な`TEST-*`を含めた
- adapterが読むreportと独自performance reportを混同しないよう分離
- source/test/reportを変更した後に古いperformance evidenceを再利用しないようgateを再実行
- persistence testではOS依存の絶対pathを期待値にしないよう修正

## 結果と限界

- `go test ./...`が成功
- redirect、expiration、delete、click count、rate limitを確認
- JSON atomic writeとgraceful shutdown経路を実装
- Go native adapterでTDD証拠を記録
- trace、graph、knowledge、Z3形式検査を実行
- operation counterを使うperformance evidenceを作成
- 公開版v0.1.1でgate `pass`、ready `true`

単一process内のrate limiterとJSON storeであり、
分散rate limitやmulti-node storageは対象外です。

---

# 実験4: Rust Event-driven Inventory Processor

## 初期要求

- stock received eventを受理する
- stock reserved eventを受理する
- stock released eventを受理する
- stock shipped eventを受理する
- available stockを負にしない
- event IDの重複を拒否する
- append-only event logへ保存する
- replayでprojectionを再構築する
- snapshotを作成・復元する
- CLIで`append`、`stock`、`history`、`verify`を提供する

## architecture

```text
CLI (clap)
  ↓
InventoryProcessor
  ├── Domain Event / Aggregate
  ├── AppendOnlyEventStore
  ├── Projection
  └── SnapshotStore
```

イベント適用の中心は、概念的に次の形です。

```rust
match event {
    StockReceived { quantity, .. } => { /* increase */ }
    StockReserved { quantity, .. } => { /* validate then reserve */ }
    StockReleased { quantity, .. } => { /* release */ }
    StockShipped { quantity, .. } => { /* validate then ship */ }
}
```

duplicate event IDはprojection更新前に拒否し、
replayでも同じ不変条件を使います。

## late change: 予約期限切れ

完成後に、次の要求変更を追加しました。

> reservationはexpiration timestampを持ち、
> 期限を迎えた予約を`expire` commandで解放できなければならない。

これは単なるCLI command追加ではありません。

- requirement追加・変更
- event schema変更
- design責務変更
- snapshot/replay互換性の確認
- fresh Red
- implementation
- Green
- trace再構築
- Formal model更新
- quality再評価

を順番に行う必要があります。

`sdd-change`のchronologyは次です。

```bash
npx --no-install musubix3 change-record \
  CHANGE-INVENTORY-EXPIRATION impact \
  --requirement REQ-INVENTORY-EXPIRATION

# requirements更新後
npx --no-install musubix3 change-record \
  CHANGE-INVENTORY-EXPIRATION requirements \
  --requirement REQ-INVENTORY-EXPIRATION

# design、red、implementation、green、qualityも同じ順で記録
```

## Cargo adapter

Rustのtest functionは、TEST IDをunderscoreへ変換して含めます。

```rust
#[test]
fn test_inventory_013_expires_due_reservations() {
    // ...
}
```

```bash
cargo test

npx --no-install musubix3 \
  tdd red TEST-INVENTORY-013 \
  --requirement REQ-INVENTORY-EXPIRATION \
  --command test
```

## mutation evidence

在庫非負などのmust functional requirementに対し、
条件演算子等を変えたmutantをauthoritative testがkillする証拠を作りました。

musubix3自身はmutation engineを同梱しません。
reportは次の情報を持つ必要があります。

- deterministic `MUT-*` identity
- requirement ID
- authoritative TEST ID
- source/test path
- source/test SHA-256
- operator
- 1始まりのline/column
- `killed` / `survived` / `skipped` / `error`

strict modeではmust functional requirementにcurrentなkilled mutantが必要です。

## 実際の失敗: input stability

初回gateは、gate実行中に生成物または入力が変化したためfail-closedになりました。
これは「たまたま最後にgreenだった」ではなく、
検査開始時と終了時で同じ入力を見ていることを要求するためです。

生成処理が完了した後、入力が安定した状態でgateを再実行し、
最終的に`pass`へ収束しました。

```bash
cargo test
npx --no-install musubix3 trace build
npx --no-install musubix3 graph index
npx --no-install musubix3 evidence refresh --changed --json
npx --no-install musubix3 gate --changed --json
```

v0.1.1では通常のCargo project rootにある`target/`を入力snapshotから
除外します。一方、単に名前が`target`というsource directoryまで
一律除外しません。source-like fileの追加・変更を試すと、
`INPUT_ADDED` / `INPUT_MODIFIED`とpath、変更前後のSHA-256を確認できました。

また、公開版で`cargo fmt --check`を後から実行すると未整形箇所を検出しました。
ここでtestも含めてformatすると、記録済みRed/Greenのtest fingerprintが変わります。
v0.1.1のSkill guidanceどおり、**formatはRedを記録する前**に完了させる必要があります。

## 実測結果

- Cargo test: **17 tests成功**、構造化TEST IDは13/13成功
- 予約期限のlate changeを要求からqualityまで伝播
- strict Code Graph成功
- Z3成功
- Leanソース生成成功、Lean実行は環境不足で`missing`
- mutation engineは未導入で、compatible validationは0 mutants
- TDD evidence成功
- change history成功
- 初回gateはinput-stabilityで拒否
- 実Copilot CLIの`sdd-change` / `sdd-quality` invocationを2/2照合
- 入力安定後の再実行でgate `pass`、ready `true`

## 限界

append-only logとsnapshotはローカルファイル前提です。
fsync、disk corruption、複数writer、schema migration、
分散event orderingまでは証明していません。

---

# 実験5: Java 21 Multi-module Order Fulfillment Platform

## bounded contextsと機能

最大の実験では、次を扱いました。

- product catalog
- customer credit limit
- idempotent order creation
- inventory reservation
- payment authorization port
- fulfillment allocation
- cancellation compensation
- order status history
- audit log
- operational health/metrics

外部databaseや重量級web frameworkを避け、
Java `HttpServer`を軽量なAPI境界として使いました。

## Maven multi-module構成

```text
order-platform/
├── pom.xml
├── domain/
├── application/
├── infrastructure/
└── api/
```

依存方向は次を意図しました。

```text
api ───────────────┐
                   ↓
infrastructure → application → domain
```

domainがinfrastructureやapiへ依存しないよう、
Code Graphのarchitecture ruleで確認します。

## ports/adapters

application側へportを置きます。

```java
public interface PaymentAuthorizationPort {
    AuthorizationResult authorize(
        OrderId orderId,
        Money amount
    );
}
```

infrastructure側に、
thread-safeなin-memory adapterを実装します。

ClockとID generationもport化し、
JUnitで決定的なstatus historyとaudit logを確認しました。

## 16件以上の要求

この実験では少なくとも16件の測定可能なEARS要求を求め、
機能要求だけでなく、performance budgetとoperational requirementも扱いました。

設計では複数ADRを使い、少なくとも次のtrade-offを記録しました。

- 外部DBを使わずin-memory adapterで実験する
- lightweight HttpServerを選ぶ
- domain/application/infrastructure/apiの依存方向
- compensationを明示的なapplication workflowとして扱う
- clock/ID/paymentをport化する

## JUnit adapter

JUnitでは正確なtagが必要です。

```java
@Test
@Tag("TEST-ORDER-001")
void test_TEST_ORDER_001_creates_order_idempotently() {
    // ...
}
```

実行:

```bash
mvn clean test

npx --no-install musubix3 \
  tdd red TEST-ORDER-001 \
  --requirement REQ-ORDER-PLATFORM-001 \
  --command test
```

JUnit XMLを構造化reportとして扱うため、
Surefireの出力directoryとmodule pathを正しく設定する必要があります。

v0.1.1ではreport pathがdirectoryの場合にXMLを再帰探索します。
再実験では次の深いpathにある9ファイルをすべて認識しました。

```text
.musubix/evidence/native/test-junit-adapter/aggregate/
└── modules/api/surefire-reports/TEST-*.xml
```

## late change: 高額注文の手動承認

完成後、次の要求を追加しました。

> 合計金額が設定可能なしきい値を超える注文は、
> fulfillmentへ進む前に手動承認を必要とする。

この変更は横断的です。

- order stateへapproval待ちを追加
- threshold設定をapplicationへ注入
- fulfillment allocation前のguard
- manual approve use case
- status history
- audit log
- API request/response
- test
- trace
- Formal transition
- change chronology

実装だけを先に直すと、要求、設計、test、traceのどこかがstaleになります。
`sdd-change`でimpactから順に進める価値が最も見えた実験でした。

## Maven固有の失敗

### timestampとstale bytecode

短時間にsourceを書き換えた後、
Mavenのincremental build成果物が期待とずれる場面がありました。
sourceは新しいのに古いclassやreportを参照すると、
TDD fingerprintとrunner resultの対応が不自然になります。

修正は単純ですが重要です。

```bash
mvn clean test
```

必要ならmoduleを明示します。

```bash
mvn -pl application -am clean test
```

TDD証拠を取り直す前に、古い`target/`とJUnit XMLを消し、
同じsourceからfreshにcompile/testしました。

### report path

multi-moduleでは`target/surefire-reports`が複数あります。
v0.1.1の再帰探索を使う場合も、集約先directoryと実際のmodule report pathが
対応していることを確認します。

各moduleの`target/`は、親に`pom.xml`があるMaven build outputとして
input-stability snapshotから除外されました。

## attestation

ローカルではEd25519関連のpayloadとverification経路を確認できます。
しかし、GitHub ActionsのOIDC token、issuer metadata/JWKS、
repository、commit SHA、run ID、workflow、refのbindingは
ローカルだけで完全には再現できません。

したがって、ローカルattestationを
「GitHub Actionsがこの処理を実行した証明」とは表現しません。
unsigned local evidenceはunsignedとして報告し、
`ci-required`の代替にしません。

## 結果と限界

- Java 21 Maven multi-module build/testが成功
- JUnitテストは9件成功、test identityは9/9
- ADRは5件
- domain/application/infrastructure/apiの依存方向を検査
- idempotency、credit、inventory、payment、fulfillment、compensationを実装
- late manual approval requirementを横断的に反映
- ネストしたJUnit XML 9件を再帰的に発見し、TDDとgateへ接続
- 9件の要求をFormal modelへ変換し、9/9のmodel correspondenceを確認
- TDDは16 cycles、late changeは1/1 complete
- performance budgetは1件成功
- trace、Code Graph、workflow evidenceを検証
- mutation engine未導入とunsigned local attestationはoptional `skipped`
- 最終gate `pass`、ready `true`
- GitHub OIDC attestationはローカル実験の限界として残した

外部DB、message broker、実payment provider、multi-node concurrencyは対象外です。
in-memory adapterのthread safetyと、分散systemの整合性は別問題です。

---

# 形式検査を正しく読む

## SATは実装証明ではない

musubix3のFormal検査は、要求に明示した抽象モデルを検査します。

対象は次です。

- controlledなBoolean obligation
- conditional
- exact integer numeric bound
- temporal interval
- deterministic state transition

例:

```text
Formal: {"kind":"numeric","subject":"availableStock","operator":">=","value":0}
```

Z3がSATを返した意味は、
**その抽象制約集合に矛盾しない割り当てが存在する**
ということです。

次は証明しません。

- Rustの全実行経路で在庫が負にならない
- transactionがatomicである
- concurrency bugがない
- file writeが壊れない
- HTTP handlerが正しい
- testが十分である

## model correspondence

このギャップを小さくするため、P4では次を別gateにしています。

```text
Formal JSON
  ↓ fingerprint
formal evidence
  ↓
fresh generated trace
  ↓ verifies edge
authoritative TEST ID
  ↓
fresh passing structured report
```

実行:

```bash
npx --no-install musubix3 formal generate \
  .musubix/features/example/requirements.md \
  --format both --json

npx --no-install musubix3 formal doctor --json

npx --no-install musubix3 formal check \
  .musubix/features/example/requirements.md \
  --solver z3 --json

npx --no-install musubix3 model-correspondence validate --json
```

model correspondenceも実装証明ではありません。
ただし「形式モデルだけが孤立してSAT」
という誤解を減らし、少なくとも現在の要求、trace、成功テストを接続します。

---

# P4機能をどう使ったか

## 1. mutation evidence

目的はmutation scoreの見栄えではなく、
must functional requirementごとに、
どのmutantをどのauthoritative testがkillしたかを追跡することです。

```bash
npx --no-install musubix3 mutation validate --json
```

注意点:

- mutation engine自体は同梱されない
- source/test fingerprintが変わるとstale
- survived/skipped/errorはstrictでは通らない
- requirementとtestがtraceで正しく接続されている必要がある

## 2. deterministic performance counter

CIで揺れやすい経過時間だけでなく、
`visitedNodes`、`visitedEntries`のような操作回数を使います。

```json
{
  "id": "TEST-PERF-001",
  "status": "passed",
  "operations": {
    "visitedNodes": 42
  }
}
```

musubix3はcommand、args、report、test status、counter、exit codeを
hash付きprovenanceとして保存します。

## 3. workflow transcript streamingと上限

`workflow-verify`はJSONL全体を一括loadせず、streamingで処理します。

既定上限:

- total: 100,000,000 bytes
- 1 line: 1,000,000 bytes
- events: 1,000,000

strict modeでは次を確認します。

- 非空行がvalid JSON object
- tool start/completionの1対1
- causal order
- Skill invocationと自己申告eventの1対1
- terminal `result`がちょうど1つ
- terminal resultが最後
- `exitCode: 0`
- UUID session ID
- freshnessとfuture skew
- raw source hashとcanonical transcript hash

## 4. attestationとOIDC

local modeでは、unsignedであること自体を明示します。

CIで強いidentity bindingを得るには、
GitHub Actions OIDCと外部Ed25519署名を使います。

ただしOIDCは、
「指定repository/workflow/ref/runが短命tokenを取得した」
というidentityを強めるものであり、
runner上の任意処理が意味的に正しかったことまでは証明しません。

また、private keyをmusubix3へ渡してはいけません。
musubix3はpayloadを作り、署名は外部で行います。

---

# 実際に遭遇したトラブルシューティング

## invalid EARS

症状:

```text
requirements validate が構文エラー
```

対処:

- 1要求1obligationにする
- `Statement`/`Acceptance`を分ける
- 6種類のcontrolled formへ合わせる
- IDを`REQ-FEATURE-001`形式にする
- priorityを`must|should|may`にする

自由文として正しいかではなく、
musubix3のschemaに適合しているかを確認します。

## invalid Formal schema

症状:

- unknown `kind`
- numericの値が文字列
- temporalに`withinMs`がない
- transitionに`from/event/to`が足りない

対処:

```bash
npx --no-install musubix3 requirements validate <file> --json
npx --no-install musubix3 formal generate <file> --format both --json
```

意味を推測させず、対応schemaへ明示的に分割します。

## wrong trace ID

症状:

- dangling endpoint
- mandatory requirementのimplementation/test coverage不足

対処:

- requirement、design、source、testのprefixと桁を統一
- 正本sourceへ注釈を置く
- proxy fileでcoverageを水増ししない
- `trace.json`を手編集しない
- 修正後に`trace build`

## report adapter issues

症状:

- native testはpassだがTDD report missing
- TEST IDが見つからない
- 対象外testまでreportに入る
- JUnit XMLのdirectoryが違う

対処:

- pytestへ`pytest-json-report`
- test名へrunner固有形式のTEST ID
- JUnitへ正確な`@Tag`
- command rootとreport pathを揃える
- stale reportを削除してfreshに生成

v0.1.1ではadapter自身が追加するreport/selector flagを
`.musubix/config.json`へ重複指定すると、実行前に設定エラーになります。
pytestの`--json-report`、Goの`-json`/`-run`などはadapterへ任せます。

## Python virtualenvがCode Graphへ入る

症状:

- `.venv/lib/python*/site-packages`がgraph nodeになる
- anyio、httpx、pydanticなど依存package内部のcycleでgraph gateが失敗する

対処:

```bash
python3.12 -m venv ../.venv-my-app
ln -s ../.venv-my-app .venv
source ../.venv-my-app/bin/activate
```

virtualenvのdependency treeをrepositoryの解析rootへ置かない構成にします。
`.venv`は`.gitignore`へ追加し、実体ではなくローカルsymlinkとして使います。
依存packageのcycleを無視するためにarchitecture policyを弱めるのは誤りです。

## stale evidence

症状:

```text
trace/formal/model-correspondence/mutation/performance が stale
```

対処:

```bash
npx --no-install musubix3 trace build
npx --no-install musubix3 graph index
npx --no-install musubix3 evidence refresh --changed --json
npx --no-install musubix3 gate --changed --json
npx --no-install musubix3 status --json
```

証拠JSONだけを編集して合わせないことが重要です。

## input-stability fail-closed

Rust実験で実際に発生しました。
gateの途中で入力や生成物が変わった場合、
一見すべてgreenでも、同じsnapshotを検査したとは言えません。

生成処理を止め、入力が安定した後にgate全体を再実行します。
v0.1.1ではdiagnosticに対象pathとbefore/after SHA-256が出るため、
どのprocessが入力を書き換えたかを追いやすくなりました。

Cargo/Mavenの通常の`target/`はmanifest単位で除外されます。
それでも失敗する場合、source-like generated fileや別build directoryを
無条件にignoreせず、生成タイミングと管理方針を確認します。

## Maven timestamp / stale bytecode

症状:

- sourceとclassの内容がずれる
- 古いSurefire XMLが読まれる
- TDD fingerprintと実行結果の対応がおかしい

対処:

```bash
mvn clean test
```

multi-moduleでは対象moduleとreport pathも確認します。

## Lean missing

症状:

```text
formal doctorでlean missing
```

対処:

- `lean --version`
- `lake env lean --version`
- shellのPATH
- `lean-toolchain`
- `MUSUBIX3_LEAN`

明示的に`--solver lean`を要求した場合、
missingを成功扱いしないのが正しい挙動です。
v0.1.1の`formal doctor`は、`lean`と`lake env lean`など
実際に試したcommand一覧と、install/configurationの推奨対応も表示します。

## unsigned local attestation

症状:

```text
local evidenceはあるがci-requiredを満たさない
```

対処:

- localではunsignedと明記する
- GitHub Actions上でOIDC tokenを取得する
- repository/SHA/run/workflow/refをbindingする
- private keyはmusubix3へ渡さず外部署名する
- offlineでJWKS取得不能ならstrict verificationを通ったと主張しない

---

# 再利用できるプロジェクト手順

以下は、今回の5実験から整理した最小templateです。

## Step 1: repositoryを作る

```bash
mkdir my-app
cd my-app
git init
npm init -y
```

Python/Go/Rust/Javaでも、
musubix3 CLIをproject-localに固定するため`package.json`を置く方法は使えます。

## Step 2: musubix3を固定

```bash
npm install --save-dev --save-exact musubix3@0.1.2
npx --no-install musubix3 init --dry-run --feature my-feature
npx --no-install musubix3 init --feature my-feature
```

## Step 3: exampleを実要求へ置換

```bash
$EDITOR .musubix/features/my-feature/requirements.md
$EDITOR .musubix/features/my-feature/design.md
$EDITOR .musubix/decisions/ADR-0001.md
```

## Step 4: validation

```bash
npx --no-install musubix3 requirements validate \
  .musubix/features/my-feature/requirements.md --json

npx --no-install musubix3 constitution validate --json

npx --no-install musubix3 design validate \
  .musubix/features/my-feature/design.md --json

npx --no-install musubix3 design c4 \
  .musubix/features/my-feature/design.md
```

## Step 5: configへ実コマンドを書く

TypeScript例:

```json
{
  "name": "test",
  "command": "npm",
  "args": ["test", "--"],
  "adapter": "vitest",
  "required": true,
  "timeoutMs": 120000
}
```

配列形式であり、shell文字列ではありません。
信頼していない`.musubix/config.json`を実行しないでください。

## Step 6: Red

Redを記録する前にformatterを実行し、test sourceを確定します。

```bash
# 例
npm run format
cargo fmt
```

Red後にtestをformatするとfingerprintが変わり、
Greenが同じtestによるものだと証明できません。

```bash
npx --no-install musubix3 trace build

npx --no-install musubix3 \
  tdd red TEST-MY-FEATURE-001 \
  --requirement REQ-MY-FEATURE-001 \
  --command test
```

## Step 7: 最小実装とGreen

```bash
npx --no-install musubix3 \
  tdd green TEST-MY-FEATURE-001 \
  --requirement REQ-MY-FEATURE-001 \
  --command test
```

## Step 8: Refactor

```bash
npx --no-install musubix3 \
  tdd refactor TEST-MY-FEATURE-001 \
  --requirement REQ-MY-FEATURE-001 \
  --command test
```

## Step 9: traceとgraph

```bash
npx --no-install musubix3 trace build
npx --no-install musubix3 trace check --strict --json
npx --no-install musubix3 trace impact REQ-MY-FEATURE-001 --json

npx --no-install musubix3 graph index
npx --no-install musubix3 graph impact src/service.ts --json
npx --no-install musubix3 graph cycles
npx --no-install musubix3 graph gate --json
```

## Step 10: knowledge

```bash
npx --no-install musubix3 knowledge build
npx --no-install musubix3 knowledge query \
  "この機能の制約とADR" --json
```

## Step 11: Formal

```bash
npx --no-install musubix3 formal doctor --json
npx --no-install musubix3 formal generate \
  .musubix/features/my-feature/requirements.md \
  --format both --json
npx --no-install musubix3 formal check \
  .musubix/features/my-feature/requirements.md \
  --solver z3 --json
```

## Step 12: 最終gate

```bash
npx --no-install musubix3 evidence refresh --changed --json
npx --no-install musubix3 gate --changed --json
npx --no-install musubix3 status --json
```

`status`は情報表示なので、未準備でもexit 0です。
必ず`status.gate.ready`とgate結果を確認してください。

---

# 何が改善し、何が高コストだったか

## 改善した点

### 「やったつもり」を減らせる

最も良い点は、Copilotの文章上の完了報告と、
機械検証した完了を分離できることです。

テストを「実行しました」と書くだけでは足りず、
fresh report、exit code、TEST ID、fingerprintが必要です。

### late changeに強い

Rustの予約期限、Javaの手動承認のような後付け要求では、
局所的なcode changeだけで終わらせない効果がありました。

### 多言語でも同じ考え方を使える

runner固有の差はありますが、
要求ID、TEST ID、trace、fingerprint、gateという軸は共通でした。

### 失敗を成功に丸めない

Lean missing、stale evidence、input mutation、unsigned attestationを
成功扱いしない点は、CIで特に重要です。

## 高コスト・awkwardだった点

### schemaに合わせる初期コスト

EARS、Formal JSON、design field、annotation IDは、
最初の1回で複数回修正が必要でした。

### runner adapterの違い

- Vitest/Jest: test name
- pytest: pluginとunderscore ID
- Go: subtest
- Cargo: Rust identifier
- JUnit: `@Tag`とXML

を理解する必要があります。

### 証拠の再生成回数

厳密なfreshnessは価値がありますが、
小さな編集でもtrace、formal、mutation、performance、gateを
順序よく再生成する手間があります。

v0.1.1では`evidence refresh [--changed]`が同じfail-closed gate pipelineを
明示的に起動するため、「どのcommandで証拠を更新するか」は分かりやすくなりました。
ただし、証拠要件そのものを弱めるcommandではありません。

### strict P4は小規模アプリには重い

mutation、workflow strict、CI attestationをすべて小さなCLIへ要求すると、
実装本体より証拠配線の方が大きくなります。

そのため、compatibleから始め、
release-criticalなrepositoryでstrictへ上げる段階導入が現実的です。

---

# v0.1.2リリース候補で5アプリを再検証

実験で見つかった問題を修正した**v0.1.2リリース候補**を
公開前にローカルtarballへpackし、5アプリを
`/tmp/work-v012`へ複製して再検証しました。

```bash
cd /path/to/musubix3
npm pack

cd /tmp/work-v012/01-task-timer
npm install --save-dev --save-exact ../musubix3-0.1.2.tgz
npx --no-install musubix3 --version
# 0.1.2
```

5件すべてのlockfileがローカル`musubix3-0.1.2.tgz`を参照する状態で、
言語固有テスト、`evidence refresh --changed`、`gate --changed`、
`status`を再実行しました。

| アプリ | 言語検証 | profile | 最終結果 |
|---|---|---|---|
| Task Timer | Vitest 7/7、typecheck、build | `recommended` | gate pass、ready true |
| Reservation API | pytest 9/9 | `minimal` | gate pass、ready true |
| URL Shortener | Go test、vet、build | `minimal` | gate pass、ready true |
| Inventory Events | Cargo 17 tests、fmt、build | `minimal` | gate pass、ready true |
| Order Platform | JUnit 9/9、Maven package | `minimal` | gate pass、ready true |

## 記事の手順を参照した最終再実験

上記の改修確認後、記事に書いた導入・言語検証・最終gateの順序に
抜けや古い記述がないか確認するため、別のfresh workspace
`/tmp/work-v012-article`でもう一度実行しました。

アプリケーションのsourceと仕様成果物は比較条件を固定するため
検証済みv0.1.2実験から複製し、`node_modules`だけを削除しました。
その後、最新sourceから再packしたtarballを各アプリへ再インストールしています。
同じ`0.1.2`を内容の異なる開発tarballへ置き換える実験環境なので、
npm cacheに旧tarballを残さないため、この再実験だけは
`npm install --force`を使用しました。公開versionや通常の新規installでは不要です。

```bash
cd /path/to/musubix3
npm pack

mkdir -p /tmp/work-v012-article
cp musubix3-0.1.2.tgz /tmp/work-v012-article/

cd /tmp/work-v012-article/01-task-timer
rm -rf node_modules
npm install --force --ignore-scripts --no-audit --no-fund
npx --no-install musubix3 --version
# 0.1.2
```

5件すべてで`npm ls musubix3 --depth=0`は`0.1.2`を返し、
各`package-lock.json`は次のローカルtarballを参照しました。

```text
file:../musubix3-0.1.2.tgz
```

実行順序は次のとおりです。

```text
1. 言語固有のtest / typecheck / build / vet / fmt
2. mutation doctor
3. evidence refresh --changed
4. gate --changed
5. status
```

最終再実験の結果も5件すべて同じでした。

| アプリ | 再実行した主要command | 実測結果 |
|---|---|---|
| Task Timer | `npm run typecheck`, `npm run build`, `npm test` | 7/7 passed、recommended、gate pass、ready true |
| Reservation API | `.venv/bin/python -m pytest tests -q`, `graph index` | 9/9 passed、minimal、gate pass、ready true |
| URL Shortener | `go test -count=1 ./...`, `go vet ./...`, `go build ./cmd/...` | pass、minimal、gate pass、ready true |
| Inventory Events | `cargo fmt --all -- --check`, `cargo test --quiet`, `cargo build --quiet` | 17 tests passed、minimal、gate pass、ready true |
| Order Platform | `mvn -q test`, `mvn -q -DskipTests package` | 9/9 passed、minimal、gate pass、ready true |

Pythonはsymlinkではない実体`.venv`を維持したまま、
再生成したCode Graphに`.venv/`と`site-packages`が含まれないことを
再確認しました。Rustでは`redPreflightCommands`に`format`が残り、
最終状態も`cargo fmt --check`を通過しています。

`mutation doctor`は各アプリのJavaScriptと対象言語を検出しましたが、
mutation engineを導入していないため全件`available=false`でした。
これはdoctorの失敗ではなく、「engineを確認できていない」という
非成功状態をJSONとexit codeで明示した結果です。

今回の再実験で、新しいmusubix3本体の修正事項は見つかりませんでした。
PythonではFastAPI TestClientとanyio aliasのdeprecation warningが2件出ましたが、
アプリ側dependencyの将来対応事項であり、pytest 9件とmusubix3 gateは成功しています。

## Python仮想環境をリポジトリ内へ戻せた

v0.1.1では`.venv`内のFastAPI、Pydantic、httpxなどがCode Graphへ入り、
第三者packageの依存関係をプロジェクトの循環として扱う問題がありました。
記事の旧手順では、外部venvを`node_modules`配下へ置き、
リポジトリ直下の`.venv`をsymlinkにする回避策を使っていました。

v0.1.2では、直下に通常ファイルの`pyvenv.cfg`を持つ
`.venv`または`venv`をPython virtual environmentとして
入力snapshot、trace、Code Graphから除外します。
任意のsource directoryへmarkerを置いても除外されず、
`pyvenv.cfg`というdirectoryもmarkerとして扱いません。

今回の再実験では`.venv`をsymlinkではない実directoryとして
Reservation API repository内へ配置しました。

```text
localVenvRegularFile=true
venvIsSymlink=false
graph mentions ".venv/"=false
graph mentions "site-packages"=false
project files indexed=7
pytest=9 passed
gate=pass
```

これにより、標準的な`python -m venv .venv`手順を記事でそのまま使えます。

## Redのfingerprintより前にformatterを実行

Rustアプリへ通常commandとしてformatterを追加し、
`tdd.redPreflightCommands`から参照しました。

```json
{
  "commands": [
    {
      "name": "format",
      "command": "cargo",
      "args": ["fmt", "--all"],
      "required": false
    }
  ],
  "tdd": {
    "redPreflightCommands": ["format"]
  }
}
```

`TEST-INVENTORY-RESERVATIONS-003`の実装だけを意図的に壊し、
さらに`return   total;`という未整形状態でRedを実行しました。
Red証拠は`valid=true`、`testStatus=failed`となり、
保存されたsourceは先に`return total;`へ整形されていました。
その後、同じテストを変更せず実装を戻し、Greenは
`valid=true`、`testStatus=passed`になりました。

formatter commandを存在しない
`missing-rust-formatter-v012`へ一時変更した制御実験では、
Redはexit 2で停止しました。

```text
TDD Red preflight command format failed with status missing and exit code none.
```

失敗したformatterを無視して、未整形sourceのfingerprintを
成功したRed証拠として残すことはありません。
部分的な1要求だけのTDD証拠は全要求TDD policyを満たさないため、
比較用JSONを`.musubix/evidence/experiment/`へ保存した後、
最終gateの正本`.musubix/evidence/tdd.json`からは除外しました。

## quality profileを明示

v0.1.2は`custom`、`minimal`、`recommended`、`release`を追加しました。
profileは設定を自動的に弱めたり、証拠を生成したりしません。
必要なcheckとstrict設定が明示されているかを検査します。

- `minimal`: requirements、design、constitution、trace、graph、commands
- `recommended`: minimalに加え、strict Code Graph、TDD、test identity
- `release`: 全証拠check、solver付きFormal、strict mutation/workflow、
  `ci-required` attestation

Task Timerは既存の7 Red-Green cycleと7 test identityを使い、
Code Graphをstrictへ上げて`recommended`で通過しました。
残る4アプリは`minimal`で通過しました。
musubix3自身のtestでは、不完全な`recommended`と`release`が拒否され、
全必須設定を持つ`release`が受理されることも確認しています。

trusted baselineがある場合は、profileのdowngrade、
Red preflightの削除や同名commandへのすり替え、workflow event skew許容値の増加を
それぞれ`POLICY_QUALITY_PROFILE`、`POLICY_TDD_PREFLIGHT`、
`POLICY_WORKFLOW_EVENT_SKEW`として拒否します。

## concurrent workflow timestampとfail-closedの境界

strict workflowではJSONLの行順を因果順序として維持しながら、
並行producerによる小さなtimestamp逆転だけを
`workflow.maxEventSkewMs`の範囲内で許容します。

Rustの未加工Copilot transcriptには、tool startが
`02:47:34.931Z`、その直後の行にあるcompleteが
`02:47:29.280Z`という約5.651秒の逆転がありました。
v0.1.1はここで直ちにtimestamp order違反となりました。
v0.1.2へ`maxEventSkewMs: 6000`を設定するとこの検査を通過し、
次の独立した厳密条件である「terminal resultが正確に1件必要」まで進みました。

このRust transcript自体にはterminal resultがないため、
v0.1.2も最終的には次の理由で正しく拒否しました。

```text
Strict workflow verification requires exactly one terminal result event.
```

つまり、並行実行の時計ずれを許容しても、
欠落したsession終端を成功扱いにはしません。
unit/integration testでは、terminal resultを含む因果順序どおりのJSONLが
許容範囲内でpassし、より小さい許容値ではfailすることを確認しました。

## mutation doctorは「未導入」を成功にしない

全5アプリで次を実行しました。

```bash
npx --no-install musubix3 mutation doctor --json
```

検出したecosystemに応じて、次の安全なprobeを試行します。

| ecosystem | probe | 今回の結果 |
|---|---|---|
| JavaScript | `npx --no-install stryker --version` | missing |
| Python | `mutmut --version` | missing |
| Go | `go-mutesting --version` | missing |
| Rust | `cargo mutants --version` | missing |
| Java | `pitest --version` | missing |

5アプリにはmutation engineを追加していないため、
`available=false`かつ各engineは`missing`でした。
doctorはinstallを実行せず、`npx`にも`--no-install`を付けます。
設定済みの任意commandは安全のため勝手に実行せず、
`configured`と「実行可能性を確認済み」を区別します。
実際のreport freshnessとmutant結果の正本は、引き続きgateです。

## 維持したfail-closed特性

v0.1.2で緩めなかった点も重要です。

- stale evidenceはreadyにならない
- Red/Green間で正本testが変われば拒否する
- gate中に入力が変化すれば拒否する
- Z3/Lean missingを成功扱いしない
- unsigned local attestationをCI provenanceにしない
- SATを実装正当性の証明と表現しない
- trusted policy baselineを無断で弱めない

改善は、誤検知や導入時の摩擦を減らすためのものです。
証拠が欠落した状態を成功へ丸める変更ではありません。

---

# v0.1.3: C#/.NET 8の中規模アプリで追加検証

既存の5アプリで使っていなかった言語としてC#を選び、
`/tmp/work-v013`にFulfillment Hubを構築しました。
hostへ.NET SDKを導入するsudo権限がなかったため、
公式`mcr.microsoft.com/dotnet/sdk:8.0` containerを使用しています。

solutionは次の5 projectです。

| project | 責務 |
|---|---|
| `FulfillmentHub.Domain` | 注文aggregate、状態遷移、監査履歴 |
| `FulfillmentHub.Application` | 冪等性、在庫予約、逆順compensation |
| `FulfillmentHub.Infrastructure` | process-local repositoryとinventory adapter |
| `FulfillmentHub.Api` | 注文、承認、拒否、出荷、health endpoint |
| `FulfillmentHub.Tests` | xUnitによる7件の要求対応test |

初回のv0.1.2相当engineでは、次の不足を実測しました。

- 各`.csproj`配下の`obj/`生成C#がCode Graphへ入る
- `bin/`と`obj/`更新がinput-stabilityを壊し得る
- xUnitの標準TRXを読むbuilt-in adapterがない
- `mutation doctor`がC#とStryker.NETを検出しない
- Dockerをrunごとに破棄するとNuGet cacheが消え、`--no-restore`が失敗する

v0.1.3では`dotnet` adapterを追加しました。

```json
{
  "name": "test",
  "command": "./scripts/dotnet.sh",
  "args": ["test", "FulfillmentHub.sln", "--no-restore"],
  "adapter": "dotnet",
  "required": true,
  "timeoutMs": 240000
}
```

xUnit testはTRXへ残る`DisplayName`に正確なIDを置きます。

```csharp
[Fact(DisplayName = "TEST-FULFILLMENT-006 compensates partial inventory failure")]
public void CompensatesInventoryFailure()
{
    // ...
}
```

adapterは集約実行では7件の`UnitTestResult`を正規化し、
対象実行では次のfilterを生成します。

```text
dotnet test FulfillmentHub.sln --no-restore \
  --logger "trx;LogFilePrefix=results" \
  --results-directory .musubix/evidence/native/test/TEST-FULFILLMENT-006 \
  --filter "DisplayName~TEST-FULFILLMENT-006|Name~TEST-FULFILLMENT-006"
```

対象TRXは`TEST-FULFILLMENT-006`だけを`passed`として返しました。

また、`.csproj`、`.fsproj`、`.vbproj`を持つproject directory直下の
`bin/`と`obj/`だけをbuild outputとして除外します。
任意のsource directory名`obj`は除外しません。
Docker用NuGet packagesはproject-local `.nuget/packages/`へ永続化し、
dependency cacheとしてsnapshotとCode Graphから除外しました。

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e NUGET_PACKAGES=/work/.nuget/packages \
  -v "$PWD:/work" -w /work \
  mcr.microsoft.com/dotnet/sdk:8.0 dotnet "$@"
```

`mutation doctor`は`.csproj`を検出すると、downloadを行わない
次のlocal tool probeを実行します。

```text
dotnet tool run dotnet-stryker -- --version
```

実験環境のhostにはdotnet executableがないため、
結果は`Stryker.NET: missing`でした。これは成功へ丸めず、
pinned local tool manifestの導入を推奨します。

v0.1.3ローカルtarballを再導入した最終結果は次のとおりです。

```text
dotnet build: pass
xUnit: 7/7 passed
Code Graph files: 5
obj in graph: false
bin in graph: false
test identities: 7/7 passed
gate: pass
ready: true
```

## Code Graph対応言語の拡張と順次検証

C#実験後、未実験言語を調査するとKotlin、Ruby、Swiftだけでなく、
Dart、Scala、Elixir、Haskell、Lua、Zig、Solidity、Objective-C、
F#、Visual Basic .NETもnative dependency graphを持っていませんでした。
v0.1.3では各言語に、comment/stringを除外した保守的な解析を追加しました。

| 順序 | 言語 | 主なdependency形式 | 検証結果 |
|---:|---|---|---|
| 1 | C/C++ | `#include` | pass |
| 2 | Kotlin | `import`、script `@file:Import` | pass |
| 3 | Swift | module `import` | pass |
| 4 | Ruby | `require_relative`、`require`、`load` | pass |
| 5 | PHP | `require`、`include`、namespace `use` | pass |
| 6 | Dart | relative/self-package `import`、`export`、`part` | pass |
| 7 | Scala | package `import` | pass |
| 8 | Elixir | `alias`、`import`、`require`、`use`、file require | pass |
| 9 | Haskell | module `import` | pass |
| 10 | Lua | `require`、`dofile`、`loadfile` | pass |
| 11 | R | `source`、`library`、`require` | pass |
| 12 | Julia | `include`、`using`、`import` | pass |
| 13 | Zig | `@import` | pass |
| 14 | Solidity | relative/root source-unit `import` | pass |
| 15 | Objective-C/C++ | `#import`とmessage send | pass |
| 16 | F# | `#load`、`open` | pass |
| 17 | Visual Basic .NET | `Imports` | pass |

各fixtureは、source file一覧、local/external dependency、declaration symbol、
direct call、`unsupportedFiles=[]`を独立して確認しました。
さらに、存在しない明示的local dependencyは`GRAPH_UNRESOLVED`となり、
commentまたはstring内の偽symbol/callはgraphへ入りません。

Kotlin/Scalaのwildcard package、F#/VBのnamespace importは、
一致するlocal fileを1件へ丸めず、該当するすべてのfileへedgeを作ります。
Dartは`pubspec.yaml`の`name`を使ってself-package URIを`lib/`へ解決し、
Elixirは`alias Demo.{Foo, Bar}`を展開します。
Objective-Cの同名selectorはreceiver classで絞り込み、
所有関係が曖昧ならtargetを`null`に保ちます。

これらはcompilerやlanguage serverの完全なsemantic解析ではありません。
reflection、macro展開、generated code、build tool固有のremappingは
必要に応じて未解決またはexternalとして保持する、fail-closedなbest-effort解析です。

## 23言語の大規模アプリケーション検証

中規模実験で見つかったcache、trace、import、symbol、call解決の問題を修正後、
全対応言語で共通の大規模合格基準を設定しました。

- authored implementation sourceが20ファイル以上
- 要求IDとnative test identityが15件以上
- 複数module/layer間に実際のdependencyとcallがある
- strict Code Graphで未解決local importと禁止cycleが0件
- design、implementation、testのtrace coverageが100%
- `evidence refresh --changed`と`gate --changed`が成功
- `status.gate.ready=true`

結果は次のとおりです。

| 言語グループ | アプリ数 | 実装ファイル | 要求/テスト | ready |
|---|---:|---:|---:|---:|
| JavaScript/TypeScript、Rust、Python、Go、Java | 5 | 114 | 75 | 5/5 |
| Kotlin、C/C++、Objective-C/C++、C#、F#、VB.NET | 6 | 120 | 90 | 6/6 |
| Ruby、PHP、Swift、Dart、Scala | 5 | 100 | 75 | 5/5 |
| Elixir、Haskell、Lua、Zig、Solidity、R、Julia | 7 | 141 | 105 | 7/7 |
| **合計** | **23** | **475** | **345** | **23/23** |

各アプリは業務workflowを持つ独立した構成で、テスト数を水増しするための
反復stubは使っていません。native compiler/runtimeの成功を正本とし、
musubix3はtrace、graph、structured identity、freshnessを検査しました。

大規模実験では3件の製品欠陥を再現し、元のsource/configurationを変更せず
修正版tarballで再検証しました。

1. JUnit legacy XMLのtestcase属性にIDがなくても、
   `system-out`の`display-name`からTEST IDを正規化する。
2. F#のネスト可能な`(* ... *)`block commentからtrace annotationを抽出する。
3. JUnit XMLで`classname`が`name`より先に並んでも、
   属性順に依存せず`name`を優先してidentityを解決する。

修正後は再現ケースと23アプリがすべて成功し、未修正の製品欠陥は残りませんでした。
一方、次は意図的に維持した境界です。

- 言語別Code Graphは決定的な静的best-effort解析であり、compilerの代替ではない
- 今回のformal modeled fractionは任意で、trace 100%は定理証明を意味しない
- 公式container tagはtoolchain再現に有用だが、長期保存ではdigest固定が必要

大規模実験の一次証拠はsession workspaceの
`language-experiments-large/all-languages-report.json`へ集約しました。
アプリ本体とraw diagnosticsはmusubix3 repositoryへコミットしていません。

---

# 再現とクリーンアップ

今回の実験directoryは次です。

```text
/tmp/work-v011/01-task-timer
/tmp/work-v011/02-reservation-api
/tmp/work-v011/03-url-shortener
/tmp/work-v011/04-inventory-events
/tmp/work-v011/05-order-platform

/tmp/work-v012/01-task-timer
/tmp/work-v012/02-reservation-api
/tmp/work-v012/03-url-shortener
/tmp/work-v012/04-inventory-events
/tmp/work-v012/05-order-platform

/tmp/work-v012-article/01-task-timer
/tmp/work-v012-article/02-reservation-api
/tmp/work-v012-article/03-url-shortener
/tmp/work-v012-article/04-inventory-events
/tmp/work-v012-article/05-order-platform

/tmp/work-v013

~/.copilot/session-state/<session-id>/files/language-experiments
~/.copilot/session-state/<session-id>/files/language-experiments-large
```

各directoryの`EXPERIMENT.md`が実験時点の詳細な一次レポートです。
ただし、これらは一時領域にあり、musubix3 repositoryへコミットされていません。

削除前に必要な証拠だけを、秘密情報を除外して安全な場所へ退避してください。
raw Copilot transcriptには、prompt、path、tool metadataが含まれ得ます。
公開前に必ずreviewします。

個別削除:

```bash
rm -rf /tmp/work-v011/01-task-timer
rm -rf /tmp/work-v011/02-reservation-api
rm -rf /tmp/work-v011/03-url-shortener
rm -rf /tmp/work-v011/04-inventory-events
rm -rf /tmp/work-v011/05-order-platform

rm -rf /tmp/work-v012-article/01-task-timer
rm -rf /tmp/work-v012-article/02-reservation-api
rm -rf /tmp/work-v012-article/03-url-shortener
rm -rf /tmp/work-v012-article/04-inventory-events
rm -rf /tmp/work-v012-article/05-order-platform
```

`rm -rf`の実行前に、対象pathを`pwd`と`find`で確認してください。

```bash
find /tmp/work-v011 -maxdepth 2 -type f | sort
find /tmp/work-v012-article -maxdepth 2 -type f | sort
```

---

# まとめ

最初の5アプリと、v0.1.3の全23言語大規模アプリで確認できたのは、
musubix3が「AIにコードを書かせるツール」ではなく、
**AIが行った開発を、仕様と現在の実行証拠へ結び直すツール**
だということです。

小さなTask Timerでは、Clock/Storage境界とTDDの基本が見えました。
Reservation APIでは、時間・容量制約とpytest reportの難しさが見えました。
URL Shortenerでは、Go adapterと決定的performance counterが効きました。
Inventory Processorでは、late change、mutation、Z3、Lean生成物、
input-stability fail-closedが実際に働きました。
Order Platformでは、multi-module依存、JUnit report、横断的な手動承認変更、
local attestationの限界が明確になりました。
さらに23言語の大規模検証では、同じ完了条件を異なるmodule/import/test文化へ
適用できることと、JUnit identity、F# commentのような言語固有差分を
再現ケースから製品修正へ戻せることを確認しました。

musubix3を使っても、仕様の妥当性、テスト設計、security review、
本番運用設計が自動的に正しくなるわけではありません。

それでも、

> - 要求を変えた
> - テストを先に失敗させた
> - 実装を変えた
> - 同じテストが成功した
> - traceと形式モデルを更新した
> 現在のsourceに対するgateが通った

という履歴を、文章だけでなく検証可能な形へ近づけられます。

GitHub Copilot CLIを本格的な開発へ使うほど、
「生成能力」より「完了条件の設計」が重要になります。
musubix3は、その完了条件をrepository内へ残すための実践的な土台でした。

---

# 関連リンク

- [npm: musubix3 0.1.3](https://www.npmjs.com/package/musubix3/v/0.1.3)
- [GitHub: nahisaho/musubix3](https://github.com/nahisaho/musubix3)
- [GitHub Release: v0.1.3](https://github.com/nahisaho/musubix3/releases/tag/v0.1.3)
- [README（日本語）](../README-ja.md)
- [README（English）](../README.md)
- [musubix2からmusubix3で変わったこと](MUSUBIX2-TO-MUSUBIX3.md)
- [設計判断 ADR-0001](../assets/ADR-0001.md)
