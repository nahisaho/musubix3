# Workflow multi-session verification design

## DES-WORKFLOW-MULTI-SESSION-001: Multi-transcript compatible reconciliation
Responsibilities: `workflow-verify`(および`verifyWorkflowLogFile`)が複数のトランスクリプトファイルパスを受け取り、各ファイルの最古イベント時刻、次に正規化絶対パスのUnicode scalar-value順へ並べた単一の論理イベントストリームとして`verifyWorkflowChunks`へ供給する。最古イベント時刻を抽出できないファイルは時刻を持つ全ファイルの後に置き、その集合内も同じ正規化絶対パス順にする。既存のバイト単位ハッシュ計算・行制限・イベント数上限・重複`toolCallId`検出はファイル境界をまたいで単一ストリームとして継続して適用する。CHANGE-0048以降、現在runの抽出結果はDES-WORKFLOW-RESUMED-SESSION-DURABILITY-002のdurable ledgerへmergeされ、照合はDES-WORKFLOW-RESUMED-SESSION-DURABILITY-003のcanonical ledger時刻順で行う。
Interfaces: `verifyWorkflowLogFile(root, paths: string | string[], options)`は`paths`を配列で受理する(既存の単一パス呼び出しは内部で長さ1の配列として扱い、動作を変更しない)。CLI `workflow-verify <log...>`は可変長引数化し、複数ファイルはstatで各々存在確認後、前記の決定的時刻順で連結する。`WorkflowManifest.verification.sourceSha256`はその連結済みバイト列全体に対するハッシュとする(単一ファイル時は既存値と同一)。durable ledger の compatible provenance は invocation を生成した個別ファイルの正規化済みバイト列ハッシュを `sourceSha256` とする。これはファイルから読んだ固有 bytes の SHA-256 であり、連結時に追加する synthetic boundary newline を含めない。同じファイルを別の複数ファイル集合で再検証しても同一 source として union され、単一ファイルでは `verification.sourceSha256` と一致する。
Constraints: Config、`--strict`、`--session-id`適用後のeffective modeがstrictなら複数ファイルの指定を拒否する(strictは単一セッションの完全終了証跡を要求するworkflow-session-shutdown機能の前提と矛盾するため)。effective compatibleモードでのみ複数ファイルを許可する。同一`toolCallId`が複数ファイルにまたがって出現した場合は既存の非ゼロ終了で拒否する。引数順はsource hash、ledger、bindingsへ影響しない。同一最古時刻および時刻なしファイルを含む引数反転テストでこの性質を固定する。
Requirements: REQ-WORKFLOW-MULTI-SESSION-001
ADRs: ADR-0010

## DES-WORKFLOW-MULTI-SESSION-002: Cross-file duplicate boundary and durable merge handoff
Responsibilities: Keep same-run duplicate rejection limited to one `toolCallId` appearing in two or more distinct supplied files, then hand the validated current-run invocation set to the durable merge planner. Preserve compatible single-file duplicate behavior and make later-run semantic re-presentation idempotent through the ledger merge.
Interfaces: `verifyWorkflowLogFile(root, paths, options)` current-run extraction result consumed by `planWorkflowReconciliation`.
Constraints: File argument order cannot affect canonical ledger or bindings. Strict mode still accepts exactly one file. Cross-run conflicts use `WORKFLOW_INVOCATION_CONFLICT`, not the same-run cross-file error.
Depends-On: DES-WORKFLOW-MULTI-SESSION-001
Requirements: REQ-WORKFLOW-MULTI-SESSION-001, REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-001
ADRs: ADR-0010, ADR-0041
