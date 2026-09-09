# Copilot session shutdown workflow design

## DES-WORKFLOW-SHUTDOWN-001: Strict terminal normalization
Responsibilities: strict transcript解析時に従来の`result`と現行Copilot CLIの`session.shutdown`を共通のterminal identityへ正規化し、完全性条件を一箇所で検証する。
Interfaces: `verifyWorkflowLog`、`verifyWorkflowLogFile`、`sanitizeWorkflowLogFile`、`WorkflowManifest.verification`。
Constraints: `result`互換を維持する。shutdown形式では一意な`session.start` UUID、正確に1件かつ最終イベントの`session.shutdown`、`data.shutdownType="routine"`を必須とする。両形式の混在、複数session、非routine、非final、欠落を拒否する。検証前のログ変換は禁止する。
Requirements: REQ-WORKFLOW-SHUTDOWN-001
ADRs: ADR-0005
