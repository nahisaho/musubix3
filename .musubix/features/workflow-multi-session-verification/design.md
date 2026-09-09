# Workflow multi-session verification design

## DES-WORKFLOW-MULTI-SESSION-001: Multi-transcript compatible reconciliation
Responsibilities: `workflow-verify`(および`verifyWorkflowLogFile`)が複数のトランスクリプトファイルパスを受け取れるようにし、それらを指定順に連結した単一の論理イベントストリームとして`verifyWorkflowChunks`へ供給する。既存のバイト単位ハッシュ計算・行制限・イベント数上限・重複`toolCallId`検出はファイル境界をまたいで単一ストリームとして継続して適用し、`validateWorkflow`の`invokedAt`/`completedAt`時刻ベースの照合ロジックは変更しない(ファイル指定順ではなく時刻順に自然と依存する既存挙動を維持)。
Interfaces: `verifyWorkflowLogFile(root, paths: string | string[], options)`は`paths`を配列で受理する(既存の単一パス呼び出しは内部で長さ1の配列として扱い、動作を変更しない)。CLI `workflow-verify <log...>`は可変長引数化し、複数ファイルはstatで各々存在確認後、指定順に連結する。`WorkflowManifest.verification.sourceSha256`は連結済みバイト列全体に対するハッシュとする(単一ファイル時は既存値と同一)。
Constraints: `--strict`(または`--session-id`)使用時は複数ファイルの指定を拒否する(strictは単一セッションの完全終了証跡を要求するworkflow-session-shutdown機能の前提と矛盾するため)。compatibleモードでのみ複数ファイルを許可する。同一`toolCallId`が複数ファイルにまたがって出現した場合は既存の`WORKFLOW_INVOCATION_REUSED`診断で拒否する(新規診断コードは追加しない)。ファイル読込順は指定順を保持するが、これは照合結果に影響しない(照合はタイムスタンプ基準のため)。
Requirements: REQ-WORKFLOW-MULTI-SESSION-001
ADRs: ADR-0010
