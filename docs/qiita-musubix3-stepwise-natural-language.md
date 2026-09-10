---
title: "はじめてのMUSUBIX3：短いプロンプトを重ねて仕様から品質判定まで進める"
tags:
  - GitHubCopilot
  - TypeScript
  - Python
  - TDD
  - 生成AI
private: false
updated_at: "2026-09-08"
id: null
organization_url_name: null
slide: false
ignorePublish: false
---

# 1. はじめに

生成AIへ開発を依頼するとき、最初から要件、設計、実装、test、Docker、
形式検証、mutation、quality gateをすべて含む長いプロンプトを書くのは現実的ではありません。
人間は通常、最初の結果を読み、足りない点を見つけ、次の依頼を考えます。

そこで今回は、MUSUBIX3 v0.1.4を使い、在庫管理・需要予測platformを
**短い自然言語プロンプトを段階的に入力して開発する実験**を行いました。

進め方は次のとおりです。

1. 一度に依頼するのは1つの工程だけ
2. Copilotの結果を人間が確認する
3. 不足やriskを次のプロンプトへ反映する
4. 失敗を成功へ読み替えない
5. 要求、policy、thresholdを検査通過のために弱めない

人間はMUSUBIX3の個別commandを直接指定せず、自然言語で目的と停止位置を伝えました。
CopilotがSkillとCLIを使い、各工程の証跡を生成しています。

# 2. 実験条件

| 項目 | 内容 |
|---|---|
| MUSUBIX3 | local packした`musubix3@0.1.4` |
| model | hydrafusion |
| application | 在庫管理・需要予測platform |
| API | TypeScript / Node.js |
| forecast service | Python |
| database | PostgreSQL |
| runtime | Docker Compose |
| workspace | 他の実験から分離した新規directory |
| commit / push / release | 実施しない |
| 人間の操作 | 結果を確認し、次の自然言語プロンプトを入力 |

外部Copilot CLI 1.0.84-1では`--model hydrafusion`が利用できなかったため、
今回はhydrafusion modelのagentとして実行しました。

生成AIの出力は非決定的です。同じプロンプトでもfile数や実装は一致しません。
再現対象は、**結果を見て次の工程を決め、最後にdeterministic checkで判定する進め方**です。

# 3. 最終結果

最初に結論を示します。

| 項目 | 結果 |
|---|---:|
| requirements | 17（must 15 / should 2） |
| design components | 11 |
| ADR | 5 |
| native / integration tests | 29/29 pass |
| TDD | 16 genuine Red-Green cycles |
| 負の`durationMs` | 0 |
| trace coverage | design / implementation / test = 100% |
| Code Graph | 43 files / 88 imports / 217 symbols / 488 calls |
| graph cycles / violations | 0 / 0 |
| Z3 | `sat`、5/17 modeled |
| Lean | unavailable |
| mutation | 13/13 killed、survived 0 |
| performance | 2/2 budgets pass |
| model correspondence | 4/4 |
| Docker | db / forecast / apiすべてhealthy |
| readiness回復 | 約1089ms（budget 5000ms） |
| Skills | 8/8使用 |
| full gate | **fail（workflowのみ）** |
| changed gate | **fail（workflow + policy approval）** |
| status | `ready=false` |

application、test、trace、graph、formal、mutation、performanceは通りましたが、
実session transcriptを`workflow-sanitize`がtimestamp順序違反として拒否しました。
合成・編集したlogへ置き換えなかったため、最終判定は正しく`ready=false`です。

# 4. ステップ1：準備だけを依頼する

最初からapplication全体を依頼せず、環境準備だけを依頼しました。

```text
新しい独立workspaceで、MUSUBIX3 v0.1.4を使った
在庫管理・需要予測platformの開発準備をしてください。
このdirectory内だけを変更し、他の実験成果は参照・copyしないでください。

local packageをdev dependencyとしてinstallし、CLI versionが0.1.4であることを
確認してください。git repositoryを初期化して構いませんが、
commit、push、releaseはしないでください。

sdd-change Skillを開始し、projectを初期化してください。
まだ要求定義・設計・実装には進まないでください。
```

結果は次のとおりでした。

- MUSUBIX3 0.1.4を確認
- 8 Skillsの初期fileを配置
- `.musubix/config.json`、constitution、policy baselineを生成
- featureのrequirements/design雛形を生成
- warning / failureなし

準備に問題がなかったため、次は要求定義へ進めました。

# 5. ステップ2：業務要求を整理する

次は「何を作るか」だけに集中しました。

```text
feature名はinventory-demand-forecastingのまま進めてください。

sdd-requirements Skillを使い、商品と倉庫別在庫、冪等な入出庫、
引当と解除、発注状態遷移、需要履歴、移動平均予測、安全在庫、
supplier pack-size単位の補充提案、監査記録、dependency readinessを
EARS形式の測定可能な要求へ整理してください。

少なくとも12要求と、各要求の測定可能なAcceptanceを作ってください。
日本語EARSの確認として、システム以外の主語と「時」または「中」を使う
要求を1件以上含めてください。

requirements検査を実行し、失敗した場合はこの段階で修正してください。
まだ設計・実装には進まないでください。
```

初回は複文、Pattern不一致、Formal JSON、Performance schemaなど
8種類のdiagnosticが発生しました。Copilotは次を修正しました。

- 複数の義務を1要求へ詰めず、要求またはAcceptanceへ分割
- `Pattern:`をparserの判定へ合わせる
- `Formal:` JSONをschemaへ適合
- Performance test IDとunitを修正
- EARS節内の曖昧な列挙をAcceptanceへ移動

最終結果は16要求、`requirements validate: valid=true`でした。

日本語EARSでは、`システム`以外の主語と`時`を含む要求も正常にparseされました。
これはv0.1.4で改善された点の実動作確認でもあります。

# 6. ステップ3：結果を見て設計判断を追加する

要求定義の結果、既定値や境界条件が未決定だと分かりました。
そこで、人間が次の判断を追加しました。

```text
移動平均windowは設定可能で既定28日、safety factorは設定可能で既定1.65、
監査記録はappend-onlyとしてapplication層とDB権限の両方で防御、
dependency回復後5秒以内にreadinessへ反映、pack-sizeは不足量以上の
最小倍数へ切り上げるものとします。

sdd-design Skillを使い、要求ごとの設計要素、TypeScript API、
Python forecast service、PostgreSQL、Docker Compose間のinterface、
data model、制約、Mermaid構成図、ADRを作成してください。

設計検査を実行し、対応漏れや不正参照を修正してください。
まだapplication codeやtestは実装しないでください。
```

結果は11 design components、5 ADRでした。
全16要求が設計要素へ接続され、design coverageは100%になりました。

# 7. ステップ4：実装前にtestとRedを作る

ここが一括プロンプト方式との大きな違いです。
実装後にRedを再現するのではなく、**実装前で停止してtestを先に作らせました**。

```text
sdd-implementation Skillを使い、まず実装より先に16要求を追跡できる
authoritative testを作ってください。

TEST IDはMUSUBIX3がtest名から直接識別できる形式にし、Pythonは
組み込みpytest adapterでtargetできる命名にしてください。
window日数1未満、負のsafety factor、pack size 1未満を拒否するtestも含めます。

production実装は完成させず、未実装を理由にnative testが失敗する
本物のRedを実行・記録してください。人工的に失敗させたり、
実装後に巻き戻してRedを作ったりしないでください。
Redを記録したらGreenへ進まず停止してください。
```

19 testsが作成されましたが、最初にRedを記録したのは15 must要求中10件でした。
この結果を見て、Greenへ進む前に補足プロンプトを入力しました。

```text
実装前の今なら真正なRedを残せるため、残りのmust要求についても
TEST IDを個別targetして未実装によるRedを記録してください。

既にpassするtestがあれば人工的に壊さず、理由を報告してください。
test不足ならAcceptanceを検証するtestへ修正し、自然な失敗を確認してください。
まだGreen実装には進まないでください。
```

全15 must要求で真正なRedを確認できました。
各実行は対象test 1件だけにscopeされ、人工的なregressionは使われていません。

# 8. ステップ5：Green実装

Redが揃ってから実装を許可しました。

```text
設計に従ってTypeScript API、Python需要予測service、PostgreSQL migration、
Docker Composeを実装してください。
stubを実機能へ置き換え、既存testを変更して通すのではなく、
実装によって通してください。

各Redと同じTEST IDを個別targetしてGreenを記録し、全native tests、
typecheck、build、tdd validateを実行してください。
負のduration、不正整数、順序、hash chain、test fingerprint、
must要求coverageを確認してください。
```

結果:

- Vitest 16/16 pass
- pytest 3/3 pass
- typecheck / build pass
- TDD 16 cycles / 32 phases
- `durationMs` min 158ms / max 697ms / 負値0
- order 1〜32、hash chain正常
- `tdd validate: valid=true`

v0.1.3で発生した負の`durationMs` 19件は再現せず、v0.1.4の修正を確認できました。

# 9. ステップ6：Greenでも実環境につながっていなかった

Greenの報告を読むと、domain実装はin-memoryで、PostgreSQL migrationとは
接続されていませんでした。testが通ることと、要求された構成が完成したことは別です。

```text
PostgreSQL repository層を実装し、在庫、冪等key、引当、発注履歴、
需要履歴、監査記録をDBへ永続化してください。
role設定をmigrationへ追加し、audit tableのUPDATE/DELETE禁止をDB上で検証します。

integration testを追加し、Docker Composeをbuild/startしてください。
DB、forecast、APIのhealth/readiness、入出庫、需要予測、補充提案を
実HTTP経由でsmoke testし、dependency回復後5秒以内のreadinessも実測してください。
```

この追加依頼で、5種類のPostgreSQL repository、DB role、監査の二重防御、
実HTTP routeが実装されました。

- PostgreSQL integration: 8/8 pass
- db / forecast / api: healthy
- 冪等な並列stock-in: 同一movementとして処理
- 過剰stock-out: 409
- reserve / release、発注状態遷移: 正常
- 28日分のDB履歴からforecast: 10
- pack size 20の補充提案: 140
- audit UPDATE/DELETE: 権限とtriggerの両方で拒否
- readiness回復: 約1089ms（5000ms以内）

# 10. ステップ7：追跡性・Code Graph・形式検証

実環境が動いた後に、仕様からtestまでの対応を検査しました。

```text
sdd-traceabilityとsdd-formal-codegraph Skillsを使ってください。

全要求についてrequirements→design→implementation→authoritative testsの
strict traceを検査してください。strict Code Graphを生成し、import解決、
cycle、architecture violationを確認してください。

Z3でrequirementsのformal検証を実行し、modeled/totalとunsupportedを報告します。
SATは実装動作の証明ではなく、抽象化した制約の整合性だけと明記してください。
Leanはavailabilityを確認し、missingを成功扱いしないでください。
sdd-knowledgeでlocal evidenceも検索してください。
```

初回traceは93.33%でした。Python annotationがdocstring内にあり、
実コメントとしてparserに認識されなかったためです。
annotationをdocstring外へ移動すると100%になりました。

- Trace: 70 nodes / 152 edges（この時点）
- design / implementation / test coverage: 100%
- Code Graph: 43 files / 88 imports / 217 symbols / 488 calls
- cycles / violations: 0 / 0
- Z3: `sat`、5/16 modeled、11 unsupported
- Lean: missing
- Model correspondence: 4/4

`SAT`は実装の正しさを証明しません。明示的に形式化された制約同士が、
採用した抽象model上で矛盾しないことだけを示します。

# 11. ステップ8：mutation・performance・workflow

```text
must要求の重要ロジックへ実mutantを適用し、native testで検出してください。
requirement、test、mutantを対応付け、survivedがあればtestを補強します。

移動平均とpack-size丸めへ、wall-clockだけに依存しないoperation counterの
performance budgetを設定してください。model correspondenceも更新します。

8 Skillsのworkflow宣言と実発火証跡を整合させ、公開可能なtranscriptには
workflow-sanitizeを使ってください。実logを取得できなければ、
合成物で代用せずblockerとして報告してください。
```

結果:

- must-functional requirements: 13
- real mutants: 13
- killed: 13
- survived: 0
- moving average: 29 operations ≤ 500
- pack-size rounding: 3 operations ≤ 10
- model correspondence: 4/4

この工程では2つの実問題も見つかりました。

1. Python `.pyc`のstale cacheによりmutantが誤ってsurvivedになる
2. 通常comment中の`@verifies`という文字列をtrace annotationと誤認する

前者は`-B` / `PYTHONDONTWRITEBYTECODE=1`、後者は誤認するcommentの修正で解決しました。

一方、workflowは解決できませんでした。
実sessionの`events.jsonl` 34,561行を`workflow-sanitize`へ入力すると、
`Tool call ... violates event timestamp order`でfail-closedしました。
実logを並べ替えたり、合成logに置き換えたりはしていません。

# 12. ステップ9：最終品質判定

最後にsdd-qualityを使用し、全検査を再実行しました。

```text
sdd-quality Skillを使い、8 Skillsすべての使用を記録してください。
workflowのtimestamp問題は元logを改変せず、公式な別sourceがなければ
v0.1.4の再現可能なblockerとして残してください。

全test、typecheck、build、tdd validate、strict trace、graph、formal、
mutation、performance、model correspondence、full gate、changed gate、
statusを再実行してください。
失敗やmissingを成功へ読み替えず、要求・policy・thresholdを弱めないでください。
```

最終結果:

- TypeScript unit: 17/17 pass
- Python: 4/4 pass
- PostgreSQL integration: 8/8 pass
- 合計: 29/29 pass
- TDD: 16 cycles、valid
- Trace: 17要求で100%
- Graph: strict pass、cycle 0
- Formal: Z3 `sat`、5/17 modeled
- Mutation: 13/13 killed
- Performance: 2/2 pass
- Docker: 3 services healthy
- Skills: 8/8使用

それでもfull gateはfailしました。

```text
full gate:    fail (workflow)
changed gate: fail (workflow + POLICY_APPROVAL_REQUIRED)
status:       ready=false
```

`POLICY_APPROVAL_REQUIRED`はcommit禁止条件でpolicy baselineがreview可能な履歴に
存在しないためで、想定されたblockerです。workflowは実logのtimestamp順序違反です。

# 13. 一括プロンプトと段階プロンプトの違い

今回、段階的に進めたことで、人間は各結果から次の不足を発見できました。

| 観測した結果 | 次のプロンプトへ追加した内容 |
|---|---|
| 要求に既定値がない | window 28日、factor 1.65、readiness 5秒を決定 |
| Redがmust 10件だけ | Green前に残りmust要求のRedを追加 |
| Greenだがin-memory | PostgreSQL repositoryと実Docker smokeを要求 |
| Python trace coverage 93.33% | annotation位置を修正して再検証 |
| Performance fieldがfunctional要求へ付けられない | non-functional REQ-017を追加 |
| integration testが環境なしでskip | Docker DBを起動し8件を実行 |
| workflow sanitizeが拒否 | 合成せず最終blockerとして保持 |

一括プロンプトでは「全部やった」という最終報告だけを読みがちです。
段階方式では、**GreenだがDB未接続**、**testはあるがRed evidence不足**、
**suite passに見えるがintegration testはskip**といった差を途中で発見できます。

# 14. v0.1.4で確認できた改善

今回の実験では次を確認できました。

## 14.1 TDD duration

16 cyclesの全phaseで負値は0件でした。
v0.1.3で観測されたwall-clock後退由来の負値は再現していません。
`tdd validate`も`valid=true`です。

## 14.2 日本語EARS

`システム`以外の主語と`時`を含む要求をparseできました。

## 14.3 pytest TEST ID

Python testは組み込みpytest adapterで個別targetできました。
project-local runnerによる回避は不要でした。

## 14.4 厳格な失敗

TDD、trace、graph、mutation、input stabilityは途中の不整合を実際にfailさせました。
単にgateを通しやすくしたのではなく、不正確な証跡を拒否する方向へ改善しています。

# 15. 新しく見つかった課題

`workflow-sanitize`は安全側へfail-closedしましたが、実際のCopilot session logにある
非単調timestampを受理できず、8 Skillsを使用していてもworkflow reconciliationを
完了できませんでした。

この結果から必要なのは、timestamp順序を無視して通すことではありません。
例えば次の検討が必要です。

- Copilot CLIが保証するevent orderingの仕様確認
- 並行tool callを表現できるworkflow schema
- source順とtimestamp順が異なる場合の明確なdiagnostic
- 改変せず正規化できる条件と、そのprovenanceの定義

修正前に、MUSUBIX3側の問題か、入力log側の契約違反かを切り分ける必要があります。

# 16. 実務向けの短いプロンプト構成

長文を一度に作らなくても、次の型で進められます。

```text
1. 今回の工程だけを書く
2. 前工程で決まった値を引き継ぐ
3. 実施してはいけない次工程を書く
4. deterministic checkを要求する
5. 失敗を成功扱いしないよう指定する
6. 数値とblockerを報告させる
```

例えば要求定義なら、次程度から始められます。

```text
この業務を測定可能なEARS要求へ分解してください。
requirements検査に通るまで構文を修正してください。
まだ設計や実装には進まないでください。
要求数、検査結果、次に決める必要がある事項を報告してください。
```

報告された未決定事項を読んで、次の設計プロンプトを作ります。
人間が最初から全工程を知っている必要はありません。

# 17. まとめ

今回、人間は巨大な完成形プロンプトを作りませんでした。
準備、要求、設計、Red、Green、実環境、trace/formal、mutation/performance、
quality gateという順に、結果を見ながら短い依頼を入力しました。

その結果、29 tests、真正な16 Red-Green cycles、trace 100%、strict Code Graph、
Z3、13/13 mutation、2 performance budgets、Docker実環境まで到達しました。

一方でworkflow transcriptを検証できず、最終状態は`ready=false`です。
この失敗を残したことも実験結果です。

MUSUBIX3を使った段階開発で重要なのは、最初から完璧なプロンプトを書くことではありません。

**各工程で停止し、実測結果を読み、次に足りない証拠を自然言語で追加すること**です。

関連資料:

- [MUSUBIX3 README](https://github.com/nahisaho/musubix3/blob/main/README.md)
- [自然言語を一括入力した実験](https://github.com/nahisaho/musubix3/blob/main/docs/qiita-musubix3-getting-started-natural-language.md)
- [commandを確認しながら進める版](https://github.com/nahisaho/musubix3/blob/main/docs/qiita-musubix3-getting-started.md)
