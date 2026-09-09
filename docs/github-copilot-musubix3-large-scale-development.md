---
title: "GitHub Copilot + MUSUBIX3 によるAI Codingによる大規模アプリケーション開発"
tags:
  - GitHubCopilot
  - AI
  - SpecDrivenDevelopment
  - MUSUBIX3
  - AICoding
private: false
updated_at: "2026-09-09"
id: null
organization_url_name: null
slide: false
ignorePublish: false
---

# 1. はじめに

## 1.1 「動いてます」と言われた翌週に起きること

GitHub Copilot CLIは、要件の相談、コードの生成・編集、テストの実行、レビューまでを一つの対話で進められます。実際、この記事に登場する6言語構成のECマーケットプレイスも、Copilotが対話的に生成しました。単一の小さなツールを1セッションで作り切るなら、これで十分なことがほとんどです。

問題は、これが**大規模・多言語・長期保守**のプロジェクトになった瞬間に姿を現します。Copilotだけで開発を進めているチームでは、次のようなことが繰り返し起こりがちです（以下は本記事の実験で実際に観測した特定の出来事ではなく、会話主体のAI Codingで一般的に生じやすい失敗を代表例として一般化したものです）。

- ある日のセッションで「完了しました」と報告されたコードが、実は元の要求のごく一部しか満たしていなかった。しかし会話ログはすでに流れてしまい、どの要求のどの部分が対象だったのかを後から機械的に確認できない。
- 要求を1行直しただけのつもりが、実際には設計・複数言語の実装・テストのどこまで波及したのかを誰も追跡しておらず、影響範囲の洗い出しは結局人力のgrepと記憶に頼ることになる。
- 「テスト済みです」という報告を信じてマージしたら、実は該当のテストランナーが一度も実行されておらず、アサーションだけが虚しく存在していた。
- Go・Java・Pythonなど複数言語のサービスにまたがる変更で、あるサービスが別サービスの内部実装に依存する形になっていることに、依存関係を可視化する仕組みがないため誰も気づかない。
- 「前回のセッションで承認されたはず」という思い込みのまま、実際にはコードが変わった後の状態を誰も再承認していない。

これらはCopilotの実装能力の問題ではありません。Copilotは指示された通りに速く正確に動きます。欠けているのは、**会話が終わった後にも残る、機械的に再検証できる証拠**です。小規模な開発ではこの欠落は許容できても、複数言語・複数人・複数セッションにまたがる大規模開発では、積み重なって致命傷になります。

MUSUBIX3は、この「会話の外側に証拠を残す」という一点を補うために作られたツールです。本記事では、この一般的な問題意識を出発点に、GitHub Copilotだけでは残らない証拠と、MUSUBIX3が補完する範囲を、実装した具体例とともに説明します。

## 1.2 本記事で答える問い

大規模アプリケーション開発では、次のような問いに答えられる必要があります。

- このコードは、どの要求を実装しているのか
- 要求が変わったとき、設計・実装・テストへ正しく伝播したか
- 「テスト済み」は、実際のテストランナーの結果に基づくか
- 複数言語・複数チームにまたがるとき、依存関係やimport違反を検出できるか
- 「完了」を宣言する前に、人間の承認が明示的に記録されているか

本記事では、[MUSUBIX3](https://github.com/nahisaho/musubix3)（公開版 v0.1.8）を使い、実際に6言語（Go / Rust / Java / Python / TypeScript×2）にまたがるECマーケットプレイスの一部を開発し、その実測結果とともにこれらの問いへの答えを示します。

先に、実践パート（6章）で得られた結果を示します。まず初回実装時点（6.1〜6.6節）の値、次に機能追加後（6.7節）の最終値です。

**初回実装時点**

- 対象: `examples/ecommerce-marketplace/`（本リポジトリにコミット済み）
- 要求: 6件（`REQ-MARKETPLACE-001`〜`006`）、設計: 6コンポーネント、ADR: 1件
- 実装言語: Go（在庫予約）、Rust（リスク判定）、Java（注文オーケストレーション）、Python（レコメンド）、TypeScript×2（BFF、ストアフロント）
- `graph index`: 19ファイル、30 import、59 symbol、循環依存 0
- `trace check --strict`: 25ノード、34エッジ、診断0件（要求→設計→実装→テストの全リンクが解決）
- 品質ゲート登録コマンド: 8本（テスト実行6本＋TypeScript typecheck 2本）すべて成功、テストケースは計8件（Go 1件、Rust 1件、Java 2件、Python 1件、TypeScript 3件）
- 品質ゲート: **リリース承認前は`FAIL`**（3段階中2段階のみ承認済み）、リリース承認を記録した後は`PASS`、`ready=true`

**機能追加後（6.7節、注文キャンセル機能`REQ-MARKETPLACE-007`を追加した最終状態）**

- 要求: 7件、設計: 7コンポーネント
- `graph index`: 20ファイル、38 import、75 symbol
- `trace check --strict`: 29ノード、41エッジ、診断0件
- テストケース: 計11件（`order-service`が2件→5件に増加、他言語は変更なし）
- 品質ゲート: 要求追加だけで`design validate`が拒否され、要求・設計を再承認した後も**リリース承認が古いままゲートが再びFAIL**。リリース承認を再記録して`PASS`・`ready=true`に復帰

つまり、この記事はうまくいった話だけでなく、**ゲートが実際に止めた場面**を、初回実装時と機能追加時の両方で含みます。

---

# 2. GitHub CopilotにおけるAI Codingで足りない機能とは

## 2.1 Copilotが担う役割

Copilotは実装のエンジンとして極めて優秀です。要求を理解し、リポジトリを調査し、計画を立て、ファイルを編集し、コマンドを実行し、結果を説明します。本記事の6サービスの実装コード自体も、Copilotが対話的に生成・編集しました。

## 2.2 「できました」が長期的な証拠にならない理由

しかし、会話が成功したことは、次のことを恒久的に証明しません。

- 実装された振る舞いが、明示的で測定可能な要求と一致しているか
- すべての要求が、設計・コード・信頼できるテストにつながっているか
- Red（失敗）が本当に失敗し、同じテストのままGreen（成功）になったか
- テスト・グラフ・形式検証・品質の結果が、現在のソースとまだ一致しているか
- 要求の変更が、影響を受けるすべての成果物に順序どおり伝播したか
- 証拠ファイルが後から書き換えられていないか

これらはいずれも、「その場の会話ログ」では機械的に再検証できません。セッションが終われば、会話の文脈も消えます。

もちろん、CI、PRレビュー、既存のテスト管理ツールや自作スクリプトを組み合わせれば、チームは同種の統制を独自に構築できます。ここでの論点はCopilotがこれらを代替できないということではなく、それらの証拠が対話の外側・チーム共有のリポジトリに、要求ID・設計ID・テストIDで結びついた形で一貫して残るかどうかです。

## 2.3 大規模・多言語開発で顕在化する問題

小さなCLIツール1つなら、この問題は目立ちません。しかし本記事のように、Go/Rust/Java/Python/TypeScriptにまたがる複数サービスを、複数の開発セッション・複数人で継続的に変更していく場合、次の問題が顕在化します。

- 言語ごとに異なるテストランナー（`go test`、`cargo test`、`JUnit`、`pytest`、`vitest`）の結果を、統一的に「要求が満たされたか」に結びつけられない
- サービスをまたぐ変更のとき、影響範囲を手動で追跡すると漏れが起きる
- 「動くようになった」という報告と、実際にコマンドを実行した証拠が一致しているか、後から検証できない
- 新しい開発依頼のたびに、前のセッションの承認や証拠を暗黙のうちに再利用してしまう

---

# 3. MUSUBIX3が補完するもの

## 3.1 Copilotの責務とMUSUBIX3の責務

| 領域 | GitHub Copilot | MUSUBIX3 |
|---|---|---|
| 要求の理解・提案 | 得意 | 行わない |
| コード生成・編集 | 得意 | 行わない |
| コマンド実行・調査 | 得意 | 行わない |
| 要求の構文検査（EARS） | — | 検査する |
| 要求→設計→コード→テストの追跡 | — | 生成・検査する |
| import/依存方向の検査（Code Graph） | — | 検査する |
| Red/Green証拠の記録 | — | fingerprintで検査する |
| 人間承認の記録・失効判定 | — | ハッシュで検査する |
| 「完了」の判定 | 主観的な報告 | fail-closedなgateで判定 |

MUSUBIX3はCopilotを置き換えません。Copilotが考え・編集し・実行する一方で、MUSUBIX3は「完了と呼ぶために必要な成果物と証拠」をリポジトリに残し、機械的に検査します。

## 3.2 仕様駆動開発の全体像

```text
要求（EARS）
  ↓
設計・ADR
  ↓
実装・ネイティブテスト
  ↓
トレース（要求↔設計↔コード↔テスト）
  ↓
Code Graph（import / 循環依存）
  ↓
品質ゲート（実コマンド + 決定的チェック + 人間承認）
```

本記事のECマーケットプレイスは、実際にこの全経路を通しました（6章で実測値を示します）。

## 3.3 Code Graph・形式検証・mutation・TDD証拠・attestation

MUSUBIX3のCode Graphは、TypeScript Compiler APIに加えて、Go・Rust・Java・Python・Kotlin・C/C++・.NET・Ruby・PHP・Swift・Dartなど19の言語グループに対応しています（`packages/analysis/src/graph.ts`）。本記事のGo/Rust/Java/Python/TypeScript混在プロジェクトでも、`graph index`は5言語すべてのソースを解析対象にしました。

一方、形式検証（Z3/Lean）、mutation testing、attestation（署名付き証跡）は、必要な場合にのみ追加する高度な証拠です。本記事では、要求の一部（EARS Boolean抽象化に収まるもの）だけが形式モデル化の対象になり、TDD Red/Green証拠とmutationは今回のスコープでは記録していません（6章で明記します）。これらは「使えば安心」ではなく、「使わなければ`skipped`と正直に報告される」設計です。

---

# 4. GitHub Copilot + MUSUBIX3で、AI Codingの何が変わるのか

## 4.1 「会話ログ」から「機械検証可能な証拠」へ

MUSUBIX3を使うと、「Copilotとの会話で完了したと感じた」状態から、「`requirements.md`・`design.md`・`trace.json`・`.musubix/evidence/quality.json`という、リポジトリに永続化されたファイルとして完了を確認できる」状態に変わります。これらはセッションが終わっても消えません。

## 4.2 fail-closedゲートによる完了判定の変化

`gate`コマンドは、設定されたコマンドが1つも実行されなければ「成功」ではなく「skipped」として報告し、承認が古くなれば「stale」として拒否します。本記事の実験でも、リリース承認を記録する前は、他のすべてのチェックが`pass`でも全体は`FAIL`でした。「多数のチェックが通っているから大丈夫」という直感的な判断を、機械的にブロックできることを実際に確認しました。

## 4.3 変更管理（sdd-change）による大規模開発への適用

`sdd-change` Skillは、新しい自然言語の開発依頼を、たとえ同じCopilotセッション内であっても新しい変更として扱い、前の要求・承認・TDD証拠を暗黙に引き継がせません。本記事の実験自体も、このリポジトリの既存の変更記録（`CHANGE-0003`、要求・設計承認済み・in-progress）を、ユーザーの明示的な指示のもとで継続する形で実施しました。大規模開発では、この「継続するか、新規に始めるか」を毎回明示させる仕組みが、承認の取り違えを防ぎます。

さらに本記事では、いったん`ready=true`まで到達した後に**新しい機能要件（注文キャンセル/在庫戻し）を追加する**という、大規模開発で最も頻繁に起きるシナリオも実際に試しました。要求追加だけで既存の承認が失効し、`design validate`が拒否され、再承認後もリリース承認の失効で`gate`が再びFAILする様子を確認しました。詳細な時系列とコマンド出力は6.7節を参照してください。

つまり、「1つの要求を足しただけ」でも、承認は自動的には引き継がれません。これは、大規模開発で暗黙のうちに承認が使い回される問題への、MUSUBIX3の直接的な回答です。

---

# 5. GitHub Copilot + MUSUBIX3の開発に向いているもの・向いていないもの

## 5.1 向いている開発

- 要求が比較的明確で、チームや将来の自分に対して完了根拠を残したい業務システム
- 複数言語・複数サービスにまたがり、変更の影響範囲を追跡する必要がある大規模開発
- 規約・承認プロセスへの準拠が求められるチーム開発
- 長期保守が前提で、後から「なぜこの実装なのか」を要求・ADRから追えることに価値がある開発

## 5.2 向いていないもの

- 要求そのものが定まっていない探索的なプロトタイピングやPoC
- 数十行で完結する使い捨てスクリプト
- EARS形式の要求記述や、テストID注釈といった規律にコストをかけたくない短期実験

小さく始めたい場合は、最初からすべてのSkill・ゲートを導入する必要はありません。`requirements validate`と`trace check`だけを既存プロジェクトに追加し、要求とコードの対応づけだけを試すといった段階的な導入も可能です。

## 5.3 MUSUBIX3が保証しないこと

- 要求そのものが正しい（ビジネス的に妥当である）ことは保証しない。あくまで「書かれた要求」と成果物の一致を検査する
- 形式モデルが`sat`であることは、実装が正しいことの証明ではない。本記事でも`model-correspondence`は「対応するFormal JSON付き要求がない」限り`skipped`と正直に報告される
- 分散システムとしての可用性・性能・脆弱性の完全な検出は保証しない。本記事の`security/semgrep.yml`・`observability/otel-collector-config.yaml`も、定義は用意したが実行検証はしていない（6.4節参照）
- ローカル承認は「この人が確認した」という記録であり、暗号学的な身元認証ではない。組織的な保護にはレビュー・CODEOWNERS・CI/OIDCの併用が必要

---

# 6. 実践：ECマーケットプレイスの多言語大規模開発

## 6.1 題材と環境

自然言語でのSkill駆動開発（`sdd-change`→`sdd-requirements`→`sdd-design`→`sdd-implementation`→`sdd-traceability`→`sdd-quality`)を実際に実行し、以下の6境界を持つECマーケットプレイスの一部を`examples/ecommerce-marketplace/`に実装しました。

| 境界 | 言語 | 役割 |
|---|---|---|
| inventory-service | Go | SKUごとの在庫を管理し、数量を予約する |
| risk-service | Rust | 注文金額と過去注文回数からリスクを分類する |
| order-service | Java 21 | 在庫予約とリスク判定を呼び出し、注文を受理/却下する |
| recommendation-service | Python | 静的な同時購入テーブルから関連商品を返す |
| bff | TypeScript(Node.js) | クライアントの注文送信をorder-serviceへ転送する |
| frontend | TypeScript(Next.js規約) | 注文結果をそのまま表示する |

測定対象の業務フローは、**注文作成→在庫引当→リスク判定→受理/却下**の1本です。環境はこの実験の実行環境にすでにインストールされていた、Go / Cargo(Rust) / javac・Maven / Python3 / Node.js・npmのみを使用し、Kotlin・.NET・Ruby・PHP・Swiftなど未導入の言語は選定から除外しました。

**この実験で実測した範囲を先に明確にします。** 実測したのは、各境界のネイティブテスト（言語ごとの単体テスト、`order-service`では`InventoryClient`/`RiskClient`をインメモリのフェイクに差し替えた注文フローのロジック）、要求からテストまでの静的トレース、そして品質ゲートです。Docker Composeによるサービス間の実際のネットワーク通信・分散トランザクション・E2Eの往復は、6.5節のとおりこの実験の対象外です。

再現・確認可能性のため、実験の条件を明記します。MUSUBIX3 v0.1.8、実行日2026-09-09、コミット[`e3498c2`](https://github.com/nahisaho/musubix3/commit/e3498c2e613d80ff19d4cdf8468229cb0e273939)、実行ディレクトリ`examples/ecommerce-marketplace/`（`.musubix/config.json`にゲート設定を含む）。以下の手順で同じ結果を再現できます。

```sh
git clone https://github.com/nahisaho/musubix3.git
cd musubix3
git checkout e3498c2e613d80ff19d4cdf8468229cb0e273939
npm ci
npm run build
cd examples/ecommerce-marketplace
npx --no-install musubix3 gate
```

`npm run build`を挟むのは、リポジトリ本体を`npx`経由で実行する際に、ローカルのビルド成果物（`dist/`）を使わせるためです。加えて、Go/Cargo/Maven/Python3/Node.jsの各ツールチェーンと、`bff`/`frontend`の`npm install`が事前に必要です。

## 6.2 要求・設計・承認

要求は次の6件を、EARS制御構文（`When ..., the system shall ...`）で記述しました。

```text
REQ-MARKETPLACE-001: 在庫予約（十分な在庫がある場合のみ予約を許可）
REQ-MARKETPLACE-002: リスク判定（approve/review/rejectの3値分類）
REQ-MARKETPLACE-003: 注文オーケストレーション（在庫予約とリスク判定を呼び出し、reject時はロールバック）
REQ-MARKETPLACE-004: 関連商品レコメンド（最大3件、問い合わせ対象SKUを除外）
REQ-MARKETPLACE-005: BFFでの転送（order-serviceの決定を改変せず転送）
REQ-MARKETPLACE-006: ストアフロント表示（決定テキストをそのまま表示）
```

`requirements validate`は最初、次の理由でFAILしました。

- Statementを2行に折り返して書いたところ、フィールド抽出が1行目しか読み取らず、EARSパターン判定が`invalid`になった
- 「it shall …」のように主語を代名詞にしたところ、`(the|a|an) X shall Y`という主語パターンにマッチせずEARS判定が`null`になった

いずれも実際に発生したエラーで、Statementを1行に収め、主語を明示名詞句（`the order service`など）に直したことでPASSしました。この種の「制御された記法への強制」自体が、5.2節で述べたコストの実例です。

要求・設計はいずれも`approval prepare`で提示された正確なマニフェストハッシュを使い、`approval record requirements/design --approver nahisaho --artifact-sha256 <hash> --confirm`で承認を記録しました。

## 6.3 実装とネイティブテスト（実測）

各境界に、要求を検証する最小限の実装とテストを追加し、`@id CODE-*` / `@implements REQ-*` / `@design DES-*`、テスト側は`@id TEST-*` / `@verifies REQ-*`の注釈を付けました。実際に実行した結果は次の通りです。

| コマンド | 結果 | テスト件数 |
|---|---|---|
| `go test ./...`（inventory-service） | PASS | `TestReserveStock/TEST-MARKETPLACE-001` 1件 |
| `cargo test`（risk-service） | PASS | `test_marketplace_002_...` 1件 |
| `mvn -q test`（order-service） | PASS | JUnit 2件（受理／ロールバック） |
| `python3 -m pytest`（recommendation-service） | PASS | 1件 |
| `npm run typecheck` / `npm test`（bff, vitest） | PASS | 2件 |
| `npm run typecheck` / `npm test`（frontend, vitest） | PASS | 1件 |

合計8件のテストケースを、5言語すべてで実際にコマンドを実行して成功を確認しました。

## 6.4 トレース・Code Graph・品質ゲート（実測、ゲートが止めた例を含む）

```
$ npx musubix3 graph index
Graph: 19 files, 30 imports, 59 symbols.

$ npx musubix3 graph cycles
{ "cycles": [] }

$ npx musubix3 trace build
Trace: 25 nodes, 34 edges, 0 diagnostics.

$ npx musubix3 trace check --strict
PASS / 合格
```

Go・Rust・Java・Python・TypeScript混在のリポジトリでも、`graph index`は5言語すべてのソースを解析し、循環依存は0件でした。`trace check --strict`も、6要求すべてについて注釈ベースの静的トレースが設計・実装・テストへ到達し、診断0件でPASSしました（これはID間のリンクが解決していることの検査であり、実行時の分散フローそのものを検証したものではありません）。

次に、8つのネイティブテストコマンドを`.musubix/config.json`に登録して`gate`を実行しました。**最初の結果はFAILでした。**

```
FAIL
pass    requirements [required]: 0 error(s).
pass    design [required]: 0 error(s).
...
pass    command:inventory-test ... command:frontend-test [required]: すべてexit 0
fail    approval [required]: 2/3 approval stage(s) are current.
```

原因は、要求承認・設計承認は記録済みでも、**リリース承認をまだ記録していなかった**ためです。個々のコマンドやトレースがすべて成功していても、`gate`は「3段階の承認のうち2段階しか有効でない」という理由で全体をFAILと判定しました。これは、5.2節で述べた「fail-closedゲートの実例」そのものです。

`approval prepare release`が提示した正確なマニフェストハッシュで`approval record release`を実行した後、`gate`を再実行すると次の結果になりました。

```
PASS
...
pass    approval [required]: 3/3 approval stage(s) are current.
pass    commands [required]: 8 configured command(s) executed; optional failures are nonblocking.
```

`status --json`でも`"gate": {"status": "pass", "ready": true}`を確認しました。

## 6.5 このスコープで実行しなかったこと

正直な記録として、次は「定義」または「設定」として`examples/ecommerce-marketplace/`に含めましたが、この実験では実行・検証していません。

- `docker-compose.yml`によるコンテナ間の実際の起動・通信確認
- `.github/workflows/ci.yml`のCI実行（このワークフローは`examples/`ネスト配置のため、リポジトリ本体のActionsトリガー対象にもなっていません）
- `observability/otel-collector-config.yaml`によるトレース・メトリクス収集
- `security/semgrep.yml`による実際の静的解析実行
- TDD Red/Green証拠の記録、mutation testing、attestation

これらを「成功した」と書かないことも、MUSUBIX3が要求する誠実さの一部です。

## 6.6 得られた知見

- 多言語プロジェクトでも、要求→設計→コード→テストのIDリンクは統一的に検査できた。ただし注釈規約（Python は連続する`#`コメント、PHPは`/** */`ではなく`/* */`など）は言語ごとに異なり、事前にREADMEで確認する必要がある
- EARS記法は「制御された英語/日本語」であり、自然な文章をそのまま書くと弾かれる。Statementは1行・主語は名詞句、という制約を最初から意識した方が手戻りが少ない
- `gate`はコマンドの成否だけでなく承認の状態も見るため、「テストは全部通っているのに全体はFAIL」という直感に反する結果が起こりうる。これは欠陥ではなく、意図された fail-closed 設計である
- 生成物のキャッシュディレクトリ（`.pytest_cache`など）がリポジトリ内にできると、`gate`実行中に入力が変化したとみなされ`input-stability`チェックが失敗する。除外設定にないキャッシュは、コマンド引数側で無効化する（例: `pytest -p no:cacheprovider`）か`.gitignore`で管理する必要がある

## 6.7 追加要件の開発：`ready=true`後に機能を1件追加する

6.4節で`gate`が`PASS`・`ready=true`に到達した後、大規模開発で最も頻繁に起きる作業――**既存システムへの機能追加**――を実際に行いました。追加したのは「受理済み注文のキャンセルと在庫戻し」（`REQ-MARKETPLACE-007`）です。

**影響分析（変更前）**

注文オーケストレーションを担う`REQ-MARKETPLACE-003`に対して`trace impact`を実行し、変更前に確認すべき候補範囲を洗い出しました。`trace impact`は双方向のリンク探索であり、結果は「変更必須の判定」ではなく「人間が変更前に目視で確認すべき到達範囲」です。

```
$ npx musubix3 trace impact REQ-MARKETPLACE-003
```

実際に得られた経路の1本は次の通りです。

```text
REQ-MARKETPLACE-003 → DES-MARKETPLACE-003 → ADR-0001 → DES-MARKETPLACE-006 → REQ-MARKETPLACE-006 → TEST-MARKETPLACE-006
```

`order-service`を変更すると、共有ADRを介して、一見無関係に見えるストアフロント表示の要求・テストにまで到達経路が伸びていることが、実装に着手する前に機械的にわかりました。今回はこの経路上の成果物を実際に変更する必要はありませんでしたが、影響範囲を「見た目の直感」ではなく検査結果で確認できたこと自体が価値です。

**要求・設計の追加**

```text
REQ-MARKETPLACE-007: 受理済み注文のキャンセル（在庫を解放し、注文をcancelled扱いにする。未受理の注文へのキャンセルは拒否する）
```

`requirements validate`はPASSしましたが、続けて`design validate`を実行すると次のエラーで**実行そのものが拒否されました**。

```
musubix3: requirements approval is stale; record explicit current approval before continuing.
```

要求ファイルを1件追記しただけで、既存の要求承認ハッシュと現在の内容が一致しなくなったためです。`approval prepare/record requirements`で再承認して初めて、`design validate`が実行可能になりました。設計に`DES-MARKETPLACE-007`を追加した後も、同様に`approval prepare/record design`で再承認しました。

**実装とテスト（実測）**

`order-service`（Java）に`cancelOrder(orderId)`を追加し、`@id CODE-MARKETPLACE-007` / `@implements REQ-MARKETPLACE-007` / `@design DES-MARKETPLACE-007`の注釈を付けました。テストは新規クラス`OrderCancellationTest`に3件（受理済み注文のキャンセル成功、未受理注文へのキャンセル拒否、同一注文への二重キャンセル拒否）追加し、`mvn test`で**order-service計5件（既存2件＋新規3件）すべて成功**を確認しました。

```
$ npx musubix3 graph index
Graph: 20 files, 38 imports, 75 symbols.

$ npx musubix3 trace build
Trace: 29 nodes, 41 edges, 0 diagnostics.

$ npx musubix3 trace check --strict
PASS / 合格
```

**ゲート：再承認前は再びFAIL**

要求・設計の変更後、`gate`を再実行すると、8つの実コマンドがすべて成功していても、次の理由で**再びFAIL**しました。

```
FAIL
...
pass    command:inventory-test ... command:frontend-test [required]: すべてexit 0
fail    approval [required]: 2/3 approval stage(s) are current.
```

要求・設計は再承認済みでしたが、**リリース承認だけがまだ古いまま**だったためです。`approval prepare/record release`を実行して再承認した後に`gate`を実行すると、`PASS`・`status --json`で`ready: true`に戻りました。

**この節から言えること**

1件の要求追加であっても、承認は自動的に引き継がれません。この実験で実際にMUSUBIX3が強制した順序は、**影響分析 → 要求変更・要求再承認 → 設計変更・設計再承認 → 実装・テスト → グラフ／トレース検査 → リリース再承認 → ゲート**でした。途中のどの段階を飛ばしても、次の工程がエラーまたはFAILで止まります。これが、大規模・長期保守のプロジェクトでMUSUBIX3が実際に果たす役割です。

---

# 7. インストールから自然言語開発までの手順

本章は、6章の実験で実際に踏んだ手順に沿って構成します。

## 7.1 前提条件

- Node.js ≥ 20
- GitHub Copilot CLI（`copilot`コマンド）が利用可能であること
- 対象プロジェクトで使用する言語のツールチェーン（本記事ではGo, Cargo, javac/Maven, Python3, Node.js/npm）

## 7.2 インストール

本記事の手順・実測結果（v0.1.8）をそのまま再現する場合はバージョンを固定します。最新版を試す場合は、コマンド仕様やゲート結果が本記事と異なる可能性があります。

```sh
# 本記事の手順・実測を再現する場合（バージョン固定）
npm install --save-dev --save-exact musubix3@0.1.8

# 最新版を評価する場合（本記事との差分があり得る）
npm install --save-dev --save-exact musubix3@latest

npx --no-install musubix3 --version
npx --no-install musubix3 init --dry-run
npx --no-install musubix3 init
copilot
```

`init`は`.github/skills/sdd-*`と`.musubix/`の初期構成をコピーします。既存ファイルは保持され、`--dry-run`で事前に変更内容を確認できます。本記事の実験でも、`examples/ecommerce-marketplace/`を独立したプロジェクトとして扱うため、

```sh
npx musubix3 init --root examples/ecommerce-marketplace --feature ecommerce-marketplace
```

のように`--root`と`--feature`を指定し、専用の`.musubix/`ワークスペースを作成しました。

## 7.3 自然言語での開発依頼〜承認〜品質ゲートまでの流れ

Copilotへの依頼はこの一言から始まります。

> 「`sdd-change`を使って、在庫予約・リスク判定・注文オーケストレーションを持つECマーケットプレイスの一部を開発してください。」

以降、Copilotは次の順で実際にコマンドを実行しながら進めます（6章で示した実測結果と同じ流れです）。

1. `requirements validate` が通るまで要求を修正
2. `approval prepare requirements` → 提示されたハッシュで `approval record requirements --approver <name> --artifact-sha256 <hash> --confirm`
3. `design validate` が通るまで設計を記述
4. `approval prepare design` → `approval record design ...`
5. 各言語で実装とテストを作成し、`@id`/`@implements`/`@design`・`@verifies`注釈を付与
6. `graph index` → `trace build` → `trace check --strict`
7. `.musubix/config.json` に実コマンドを登録し `gate` を実行(最初はFAILしうる)
8. `approval prepare release` → `approval record release ...` の後に再度 `gate` を実行し、`status` で `ready: true` を確認

---

# 8. まとめ

GitHub Copilotは実装のエンジンとして強力ですが、「完了」をチームの資産として残すには、要求・設計・トレース・品質ゲート・人間承認という、機械的に検証可能な証拠が別途必要です。MUSUBIX3はこの証拠を、Copilotの会話とは独立にリポジトリへ永続化し、fail-closedに検査します。

本記事では、Go/Rust/Java/Python/TypeScriptにまたがる実際のECマーケットプレイスの一部を開発し、初回実装（要求6件・設計6コンポーネント・テストケース8件）で`trace check --strict`診断0件、**リリース承認前はゲートが実際にFAILした**という、うまくいかなかった実例も含めて報告しました。さらに、`ready=true`到達後に注文キャンセル機能を1件追加し（最終的に要求7件・設計7コンポーネント・テストケース計11件）、そこでも同じ「止められる」性質を確認しました。ただし止まった理由は異なります。初回は**未記録のリリース承認**が原因でしたが、追加変更時は**以前は有効だったリリース承認が新しい成果物によって失効した**ことが原因です（6.7節）。後者こそ、継続的な変更管理で特に重要な性質です。この「止められる」という性質が、大規模・多言語・長期保守を前提とするAI Coding開発にMUSUBIX3が提供する価値だと考えます。

すべてのSkill・ゲートを一度に導入する必要はありません。まずは既存プロジェクトの小さな変更1件に要求ID・テストIDを付け、`npx musubix3 requirements validate`と`npx musubix3 trace check`だけを実行してみることから始められます。

---

# 9. Appendix

## 9.1 インストール方法まとめ

| 用途 | コマンド |
|---|---|
| プロジェクトへ固定インストール(本記事の再現) | `npm install --save-dev --save-exact musubix3@0.1.8` |
| プロジェクトへ固定インストール(最新版) | `npm install --save-dev --save-exact musubix3@latest` |
| 一度きりの評価 | `npx musubix3@latest --version` / `npx musubix3@latest init --dry-run` |
| Copilotネイティブプラグイン(ローカル) | `copilot plugin install ./musubix3` |
| Copilotネイティブプラグイン(GitHub) | `copilot plugin install nahisaho/musubix3` |
| Marketplace経由 | `copilot plugin marketplace add nahisaho/musubix3` → `copilot plugin install musubix3@musubix3-marketplace` |
| リポジトリ本体のビルド | `git clone https://github.com/nahisaho/musubix3.git && cd musubix3 && npm install && npm run build` |
| 別プロジェクトへの初期化 | `npx musubix3 init --root <dir> --feature <slug>` |

`init`（`install`のエイリアス）は既存ファイルを保持し、`--force`で指定パスのみ上書きします。Copilotのグローバル設定・MCP・LSP・hooksは変更しません。

## 9.2 コマンドリファレンス（v0.1.8 `--help`より抜粋・分類）

| コマンド | 目的 | 代表構文 |
|---|---|---|
| `init` / `install` | Skills・SDD雛形の導入 | `npx musubix3 init [--dry-run] [--force] [--feature slug]` |
| `requirements validate` | EARS要求の構文検査 | `npx musubix3 requirements validate <file>` |
| `design validate` | 設計の項目・要求ID参照検査 | `npx musubix3 design validate <file>` |
| `design c4` | Mermaidコンポーネント図生成 | `npx musubix3 design c4 <file>` |
| `approval prepare/record/validate` | 人間承認の提示・記録・検査 | `npx musubix3 approval prepare requirements` |
| `trace build` / `trace check` | トレース生成・網羅性検査 | `npx musubix3 trace check --strict` |
| `trace impact` | 変更影響の双方向探索 | `npx musubix3 trace impact REQ-MARKETPLACE-001` |
| `graph index` | import・symbolのインデックス化 | `npx musubix3 graph index [--changed]` |
| `graph cycles` | 循環依存検査 | `npx musubix3 graph cycles` |
| `graph gate` | 最新インデックス+アーキテクチャ規約検査 | `npx musubix3 graph gate` |
| `formal generate` / `formal check` | 形式検証入力生成・実行 | `npx musubix3 formal check <file> --solver auto` |
| `tdd red/green/refactor` | TDDサイクルの検証付き実行 | `npx musubix3 tdd red TEST-ID --requirement REQ-ID --command name` |
| `mutation validate` | 要求スコープのmutation証拠検査 | `npx musubix3 mutation validate` |
| `workflow-record` / `workflow-verify` | Skill実行宣言の記録・突合 | `npx musubix3 workflow-record sdd-change complete --status completed` |
| `change-record` | 変更フェーズのfingerprint記録 | `npx musubix3 change-record CHANGE-0001 requirements --requirement REQ-ID` |
| `gate` | 実コマンド+決定的チェックの統合実行 | `npx musubix3 gate [--changed]` |
| `status` | 成果物・準備状況の要約 | `npx musubix3 status` |
| `attestation` | 署名付き証跡の生成・検証 | `npx musubix3 attestation verify` |

## 9.3 自然言語プロンプト例集

- 「`sdd-change`を使って、注文作成時に在庫を予約し、リスクがrejectなら注文を却下する機能を開発してください。」
- 「この要求に対する設計を提示してください。承認前に`design validate`の結果を見せてください。」
- 「要求承認のマニフェストハッシュを表示してください。確認したので、approverを`nahisaho`として記録してください。」
- 「在庫予約のGoコードに対して、失敗するテストを先に書いてから実装してください。」
- 「`graph index`と`trace check --strict`を実行し、循環依存とダングリングIDがないか確認してください。」
- 「品質ゲートを実行し、FAILした場合はどのチェックが原因か具体的に教えてください。」
- 「リリース承認のハッシュを提示してください。確認後、承認を記録してもう一度ゲートを実行してください。」
- 「今回の変更が既存の`CHANGE-000N`の継続なのか、新規の変更なのかを確認してから進めてください。」
