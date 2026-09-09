# Copilot session shutdown workflow requirements

## REQ-WORKFLOW-SHUTDOWN-001: Strict routine shutdown terminal evidence
Priority: must
Type: functional
Statement: GitHub Copilot CLIの完全なセッションログが`result`イベントの代わりに`session.shutdown`を出力するとき、システムは、単一セッションのUUIDが確認でき、最後のイベントが正確に1件の`session.shutdown`であり、その`data.shutdownType`が`routine`である場合に限り、strict Workflow検証の正常終了として受理しなければならない。
Acceptance: strict検証とsanitizeが、従来の`result`形式および一意な`session.start`と最終`session.shutdown(data.shutdownType="routine")`を持つ形式で成功し、shutdownの欠落、複数session、非routine、非final、UUID不一致をエラーとして拒否すること。
