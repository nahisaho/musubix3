---
schemaVersion: 1
feature: audit-override-contract
---
# レビュー済み依存 override と audit 契約の設計

要件承認: `nahisaho` が要件 manifest
`9ff89491f0f1ea36a7e3fc29a18f7386cac6ca74d83691f56da7f45741760472`
を承認し、CLI に記録済み。承認済み requirements.md は変更しない。
本段階は設計のみであり、依存更新・実装・TDD・release 承認は未実行。

## DES-AUDIT-OVERRIDE-CONTRACT-001: 置換依存グラフのオフライン検査
Responsibilities: npm override により旧 js-yaml/argparse/sprintf-js 経路を除去し、lockfile の再生成による後退を既存 `checkLock()` 内で決定的に検出する。
Interfaces: `package.json` の `overrides: {"js-yaml":"^5.4.3"}`; npm 生成 `package-lock.json` の `packages`; `scripts/check-npm-audit-remediation.mjs lock` の既存 `packageRecords()`、`stableVersion()`、`compareVersion()` と追加の置換グラフ検査; `tests/npm-audit-remediation.test.ts` の `TEST-AUDIT-OVERRIDE-CONTRACT-001`; install 後の `npm ls js-yaml sprintf-js` と CHANGE-0052 `Verification evidence` に保持する実結果。
Constraints: lockfileVersion 3 の既存 schema 検査後、`node_modules/js-yaml` と `*/node_modules/js-yaml`、同様の argparse/sprintf-js パスを列挙する。js-yaml と argparse はそれぞれ最低 1 レコード必要。各レコードは非 null の非配列オブジェクト、`dev === true`、prerelease のない安定 numeric バージョンを要求する。js-yaml は `>=5.4.3 <6.0.0`、`dependencies` は厳密に `{"argparse":"^2.0.1"}`。argparse は `>=2.0.1 <3.0.0`、`dependencies` は未宣言または空オブジェクトに限る。両者とも optionalDependencies/peerDependencies の非空宣言や不正型を認めず、sprintf-js はルート・ネストを問わず 1 レコードでも拒否する。違反は `LOCK_OVERRIDE_GRAPH` と非ゼロ終了、正常時は既存の `{valid:true,diagnostics:[]}`。診断にレコードパスを含める。既存 Vitest/Vite/CI/config/policy 検査を削除・緩和しない。registry の新しい脆弱性はこの検査では判定せず、実 audit に分離する。manifest の直依存範囲、version `0.1.20`、本番・distribution surface の維持は今回の差分と既存 pin によって確認するが、次回の別承認された release まで恒久的に version を pin する新機構は追加しない。
実 installed-tree inspection は override 後に実施し、終了状態と js-yaml/argparse の
実 versions、sprintf-js 不在を CHANGE-0052 に記録する。空 package 検索の非ゼロ終了を
finding の成功扱いにせず、tree と lockfile 両方で不在を確認する。
この観測も DES-003 と同じ current lockfile digest に拘束し、取得順を記録する。
必要なら `npm ls argparse` も実行して実 argparse version を確認する。
lock bytes 変更時は install 後の tree を再取得し、旧 digest の結果を受容しない。
Requirements: REQ-AUDIT-OVERRIDE-CONTRACT-001
ADRs: ADR-0044

## DES-AUDIT-OVERRIDE-CONTRACT-002: manifest と root lock metadata の fail-closed 契約
Responsibilities: blanket override 禁止を唯一のレビュー済み値の pin に置き換え、未レビューの manifest/root metadata を拒否する。
Interfaces: `checkLock()` の `expectedProductionSurface` にレビュー済み `overrides` 値を追加し、既存 `Object.entries(...)/JSON.stringify(...)` 比較に統合する; manifest の blanket `Object.hasOwn(packageJson, "overrides")` guard だけを置換する; root package metadata の既存比較を維持する; `TEST-AUDIT-OVERRIDE-CONTRACT-002` と既存 TEST-NPM-AUDIT-REMEDIATION-002/003。
Constraints: manifest は exact `{"js-yaml":"^5.4.3"}` のみ許可。欠落、空、異なるキー/範囲、余分なキー、nested selector、null/配列/文字列は `MANIFEST_CONTRACT`。単一キーなので既存 JSON.stringify 比較でキー順依存は新たに生じない。設計時点で npm `11.19.0` と override 追加前の root エントリに overrides がないことを観測したが、追加後の観測結果とは混同しない。実装時の承認済み `npm install` 後、npm バージョンと root overrides の presence/value を CHANGE-0052 の `Verification evidence` に記録する。本設計の予定 pin は「root overrides 不在」であり、観測が一致した場合だけ root に対する `Object.hasOwn(rootLockPackage ?? {}, "overrides")` 拒否を実装する。root にレビュー済みオブジェクトが挿入された場合も拒否する。もし実 npm が当該フィールドを生成したら、推測でコードを進めず、設計/ADR の予定 pin を exact value に修正して再検証・再レビュー・人間の設計再承認を待つ。常時両表現を受容する fallback は禁止。npm バージョンの変更では再観測と証拠更新が必要で、pin 表現が変わる場合も再承認を要求する。既存 root dependency/devDependency/bin/engine 比較と direct @vitest/mocker 禁止を維持する。
root-lock overrides drift も `MANIFEST_CONTRACT` と非ゼロ終了で報告し、
`path` は root の `package-lock.json` とする。manifest の診断 path と区別して試験する。
npm version/root metadata の観測も DES-003 と同じ current digest と取得順を
CHANGE-0052 に記録する。一回の観測は対象 digest に対するものとし、
lock bytes 変更時は再観測する。予定 pin と異なる結果は常に再承認で停止し、
古い digest の観測を最終 lock の pin 根拠として使わない。
Requirements: REQ-AUDIT-OVERRIDE-CONTRACT-002
ADRs: ADR-0044
Depends-On: DES-AUDIT-OVERRIDE-CONTRACT-001

## DES-AUDIT-OVERRIDE-CONTRACT-003: 実 audit と現在 lockfile に結び付いた証拠
Responsibilities: registry に対する実 audit を実行し、未加工 JSON、実時刻、実 SHA-256 を保持し、既存 CHANGE-0022 の living evidence と新しい remediation history の整合を検査する。
Interfaces: 実 root `npm audit --json` の未加工出力を `.musubix/evidence/npm-audit/CHANGE-0052.json` に保存; CHANGE-0022 の既存 Audit captured at / Audited package-lock SHA-256 / Audit result を更新し CHANGE-0052 への履歴参照を追記; CHANGE-0052 の `Verification evidence` に同じ capture 時刻/lock digest と report の byte SHA-256 を記録; `checkEvidence()` が追加の override audit 証拠検査を呼ぶ; `NPM_AUDIT_REMEDIATION_ROOT`、`NPM_AUDIT_REMEDIATION_CHANGE_PATH`、`NPM_AUDIT_OVERRIDE_CHANGE_PATH`、`NPM_AUDIT_OVERRIDE_REPORT_PATH` がそれぞれ root/両 CHANGE/report の隔離 fixture を指定; `TEST-AUDIT-OVERRIDE-CONTRACT-003`。
Constraints: audit は root、開発依存込み、全 severity、非ゼロ終了を隠さず実行する。JSON の vulnerabilities オブジェクトは空、metadata.vulnerabilities の info/low/moderate/high/critical/total はすべて numeric 0 を要求し、欠落、不正型、非ゼロ、非空 finding map、report read/parse 失敗は新しい `AUDIT_OVERRIDE_EVIDENCE`。report の raw bytes を編集・正規化しない。digest は実 file bytes から計算し、CHANGE-0022 は exactly one の既存 severity summary と有効な RFC3339 UTC Z capture を維持する。新しい証拠 helper は report SHA-256、現在 LF lockfile digest、両 CHANGE の capture/digest と履歴参照を照合する。既存 GHSA-82fw-gwwq-j7x9 assessment、範囲、engine 制約、timestamp 上限、既存 `AUDIT_EVIDENCE` 診断と negative fixtures を保持する。追加環境変数は fixture 用入力で、audit の省略/exit suppression を認める設定ではない。オフライン検査は保存済み証拠の整合性を検査するだけで、registry 実行や真正性を暗号学的に証明するものではない。CLI/runner の実終了と未加工出力を別途確認して初めて実 audit 成功を主張する。後続 lockfile byte 変更は必ず新しい実 audit と capture/digest 更新を要求する。
新しい診断は問題の report/CHANGE ファイルを `path` に保持し、
TEST-003 は新 code と該当 path を要求して、既存の無関係な診断で Red/Green を
満たさない。audit 前後の lockfile byte SHA-256 を実計算して同一性を確認し、
変わっていたらその report を acceptance に使わず再実行する。
raw JSON は既存 evidence ディレクトリ内の独立した保存出力として直接記録し、
CLI の order/merge transaction 管理 JSON を手編集しない。取得中の install や
並行 evidence writer を避け、CLI 管理ストアへの原子的 merge 証明とは混同しない。
Requirements: REQ-AUDIT-OVERRIDE-CONTRACT-003
ADRs: ADR-0044
Depends-On: DES-AUDIT-OVERRIDE-CONTRACT-001 DES-AUDIT-OVERRIDE-CONTRACT-002

## DES-AUDIT-OVERRIDE-CONTRACT-004: exposure assessment と実 consumer 互換性
Responsibilities: GHSA の到達経路・攻撃前提・修正版不在・semver 範囲外移行を文書化し、YAML consumer と native Jest を実行して compatibility を検証する。
Interfaces: CHANGE-0052 の advisory assessment/Verification evidence; `checkEvidence()` から呼ぶ追加 assessment 検査と `NPM_AUDIT_OVERRIDE_CHANGE_PATH` の隔離 fixture; `TEST-AUDIT-OVERRIDE-CONTRACT-004` は installed `@istanbuljs/load-nyc-config` の公開 `loadNycConfig({cwd,nycrcPath:".nycrc.yaml"})` を実行; native コマンド `MUSUBIX_RUN_NATIVE_ADAPTERS=1 npm run test:adapters -- -t "executes and normalizes a targeted Jest test"`; 実 package archive とその file list。
Constraints: doc checker は advisory ID、baseline バージョン付き経路、unbounded precision DoS、修正版不在、dev-only/current exposure、consumer の範囲外 `^3.13.1`、残存リスクと recurring audit 方針に加え、実 `.load(await readFile(..., "utf8"))` callsite、harmless と受容せず依存を除去する判断、universal unreachability 非主張、method 名だけでの互換性非主張、全 resolved consumer inventory の文書記録の欠落を新 `AUDIT_OVERRIDE_ASSESSMENT` で拒否する。新診断の path は assessment 文書で、TEST-004 の negative fixtures は新 code と path を要求する。文言検査だけで実行成功は証明しない。TEST-004 はプロジェクト内 fixture に package.json と、boolean/数値/list を含む代表 `.nycrc.yaml` を作り、installed consumer の公開 API が期待値を読み込むことと改善済み assessment 検査を確認する。consumer による camelCase 化、cwd 追加、require/extension/exclude/include の配列正規化を考慮して期待値を検査する。override 後に lockfile の dependencies/optionalDependencies/peerDependencies から全 js-yaml consumer を再列挙し、全件を CHANGE-0052 に記録し、追加 consumer があればその YAML 呼び出し点の同等実行証拠まで readiness を阻止する。native Jest は既定 skip を成功扱いせず、上記の opt-in コマンドの named case passed とゼロ Jest skip を確認し未加工 runner 出力を保持する。production source に Jest/js-yaml/sprintf-js の import がないことを検索・確認し、`npm run pack:check`、`npm run pack:smoke` と実 npm package archive の file list に node_modules、tests、Jest/js-yaml/sprintf-js の開発依存 payload がないことを確認する。通常 test は registry を呼ばず、full tests/typecheck/build/pack/native の本当の結果は quality 証拠として別途記録する。fixtures、runner reports、package artifacts はプロジェクト内 `.test-work/` 等に置き、既存テスト/pack が os.tmpdir() を使う場合は TMPDIR/TMP/TEMP をプロジェクト内パスに設定する。生成 archive/fixture は終了時に除去し、必要な証拠出力だけを保持する。
native Jest の実行は runner/adapter 統合の所有者であり、coverage 無効のこの case が
js-yaml をロードするとは主張しない。js-yaml callsite 互換性の所有者は直接の
installed `loadNycConfig` YAML 実行であり、こちらが実 `.load()` 経路を通す。
TEST-004 は consumer 基準に解決された installed js-yaml の安定 5.x version も
確認し、override 前の 3.x tree での YAML 成功を acceptance にしない。
YAML/native Jest/archive の証拠はすべて reviewed install 後に取得し、
CHANGE-0052 に DES-003 と同じ current lockfile digest、取得順、結果、保存出力の
所在を記録する。lockfile 変更時は当該 tree を install し直し、すべて再取得する。
install 前の成功や、別 digest に対する古い結果は release acceptance に使わない。
本要件の doc clauses は新 assessment checker/negative fixtures、YAML semantics は
TEST-004、native/archive/source/full quality clauses は実コマンド結果と
release evidence review がそれぞれ所有する。一つの passing test で全 acceptance
を証明したと誤認しない。
inventory の網羅性は文章の見出し有無ではなく、新 assessment checker が同じ
root lockfile の全 `packages` から dependencies/optionalDependencies/peerDependencies の
js-yaml 宣言を導出して照合する。CHANGE-0052 の `Verification evidence` に
`Js-yaml consumer inventory: <JSON array>` という一行を置き、各 entry は
厳密に string fields `{path,kind,range}` のみとする。marker は行頭の
`Js-yaml consumer inventory: ` に完全一致する prefix として扱い、文書全体で
当該データ行は exactly one を要求する。説明文の部分一致では探さない。
導出配列は path/kind/range の code-point 順で sort し、文書の配列は
その順序付き配列に厳密一致させる。object 内の key 順だけは比較時に正規化するが、
文書の array を sort/dedupe して誤った順序や重複を隠さない。
重複 entry、順序違反、marker 行の欠落/複数、導出結果との不一致はすべて
`AUDIT_OVERRIDE_ASSESSMENT` とする。
missing/extra/changed consumer、kind/range 不正、JSON 不正の隔離 negative fixtures を
TEST-004 に含め、marker 複数・entry 重複・順序違反も追加する。
順序違反 fixture は最低 2 consumer を持つ隔離 lockfile で検査する。
inventory 一致は各 consumer の実行成功を証明しないため、
追加 consumer の YAML-callsite 実証拠は引き続き release evidence review が確認する。
Requirements: REQ-AUDIT-OVERRIDE-CONTRACT-004
ADRs: ADR-0044
Depends-On: DES-AUDIT-OVERRIDE-CONTRACT-001 DES-AUDIT-OVERRIDE-CONTRACT-002 DES-AUDIT-OVERRIDE-CONTRACT-003

## TDD と実装境界

- 新テストは上記 TEST-ID を test 名と `@id` に、対応 REQ-ID を
  `@verifies` に記載する。既存の `npm-audit-remediation-tests` コマンドと
  built-in vitest adapter を使用し、adapter が `{testId}` 相当の
  `-t TEST-ID` と fresh JSON report を付加して対象のみを実行する。
- 4 要件が同じ checker ファイルを変更するため、部分 Green 後の
  後続実装編集による fingerprint drift を避け、全要件を一つの
  Red/Implementation/Green batch とする。各 TEST-ID/REQ-ID について
  個別 `tdd red` が本当に失敗した後だけ full-set `change-record red`、
  全実装と実証拠生成後 `change-record implementation`、それから各
  個別 `tdd green`、最後に full-set `change-record green`。
- TEST-001 は旧 graph/未除去 sprintf-js、TEST-002 はレビュー済み override
  fixture が既存 guard に拒否されること、TEST-003 は新 audit 証拠の欠落、
  TEST-004 は新 assessment の不足により Red とする。既に存在する
  YAML/native API の成功を意図的に壊して Red を作らない。
- 新 assessment の TDD は「文書を追加するだけで成功」にはしない:
  TEST-004 の未完成 assessment fixture に対する診断期待が旧 checker
  で失敗し、実装した新検査によって Green になるようにする。
  この新 `AUDIT_OVERRIDE_ASSESSMENT` code/path の期待を TEST-004 の最初の
  assertion とする。同じ不変テストで、これを満たした後に installed 5.x/
  YAML semantics の assertions を実行する。Red 時は先頭の新検査不足による
  assertion failure を確認し、未 install の旧 version だけの失敗を Red 根拠に
  しない。stage 条件で assertion を skip したり Red/Green 間に test を改変しない。
- 実装コードの graph/manifest/audit/assessment 各 authoritative 検査に
  新 CODE-ID、`@implements`、`@design` を付ける。JSON manifest や
  audit report に無効なコメントを挿入せず、coverage proxy を作らない。
- `npm audit fix` は design 承認と全 Red/checkpoint の後、
  `--force` なしで先に実行。direct range/version/Vitest が動いたら
  無条件に受容せず原因を評価し、未承認変更は残さない。
  非ゼロ終了が未解決 moderate 経路を示す場合は正常な中間観測として
  記録し、zero-finding 成功とは主張しない。exact override を追加して
  `npm install` し、root metadata 観測が予定 pin と違う場合は再承認待ち。
- 必要な CHANGELOG entry と関連仕様整合化を quality 前に完了する。
  その後は typecheck/build/full tests/pack、trace/graph、適用可能な formal、
  changed-scope gate/status、release-candidate review、最終 full gate、
  release approval の順。publication/version bump/merge は対象外。

## fixture 入力の解決規則

- `NPM_AUDIT_REMEDIATION_ROOT` は root を決め、lockfile と未指定ファイルの
  default path にだけ作用する。未指定時は process cwd。
- `NPM_AUDIT_REMEDIATION_CHANGE_PATH` は既存通り CHANGE-0022 の入力だけ、
  `NPM_AUDIT_OVERRIDE_CHANGE_PATH` は CHANGE-0052 の入力だけ、
  `NPM_AUDIT_OVERRIDE_REPORT_PATH` は raw audit report の入力だけを優先指定する。
  互いの path や lockfile root を変更しない。
- explicit path の相対指定は既存 CHANGE_PATH と同じ process cwd 基準とする。
  fixture は曖昧さを避け絶対パスを渡す。未指定 default は選択 root 基準。
- positive fixtures は選択 root の実 lockfile/report bytes から digest を計算し、
  capture/両 CHANGE/retained report の整合を作る。実 repo の digest を固定しない。
  negative fixtures は一項目だけを変造し、該当する新 code/path を検査する。

## REQ ↔ DES ↔ ADR ↔ 検証の self-check

| REQ | DES | ADR | 決定的検査と実証拠 |
| --- | --- | --- | --- |
| REQ-AUDIT-OVERRIDE-CONTRACT-001 | DES-AUDIT-OVERRIDE-CONTRACT-001 | ADR-0044 | TEST-001: root/nested graph negative fixtures、npm ls |
| REQ-AUDIT-OVERRIDE-CONTRACT-002 | DES-AUDIT-OVERRIDE-CONTRACT-002 | ADR-0044 | TEST-002: exact/missing/malformed/extra overrides と root metadata drift |
| REQ-AUDIT-OVERRIDE-CONTRACT-003 | DES-AUDIT-OVERRIDE-CONTRACT-003 | ADR-0044 | TEST-003: 保存 audit/digest/history の変造検査と実 audit の終了/JSON |
| REQ-AUDIT-OVERRIDE-CONTRACT-004 | DES-AUDIT-OVERRIDE-CONTRACT-004 | ADR-0044 | TEST-004: assessment/YAML load、別途 native Jest と実 archive/quality |

## 設計段階の検証範囲

`design validate`、`design c4`、generated `trace build` と `trace check` を実行する。
strict implementation/test coverage は未実装のため本段階では成功と主張しない。
compiler graph に shell-spawned checker/consumer の実行経路はすべて現れないため、
graph は exposure/behavior の証明として使用しない。registry、file-byte digest、
third-party YAML behavior の formal/SAT 証明も主張しない。
