---
schemaVersion: 1
id: CHANGE-0042
summary: Scope transaction directory-sync suppression to Windows capabilities
status: staged
---
# CHANGE-0042: transaction-directory-sync-policy

Source: GitHub Issue #43.

Requirements: REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001

## Intent

Prevent Quality refresh and evidence merge from silently accepting actionable
directory synchronization failures on Linux, macOS, or unsupported error codes.

## Classification

- Durability defect correction and cross-platform behavior change.

## Impact

- Share one platform/error classifier with the evidence writer-lock policy.
- Keep transaction file synchronization fail-closed.
- Keep directory handles read-only and propagate open and close failures.
- Suppress only `EPERM`, `EINVAL`, or `ENOTSUP` from synchronizing an
  already-open directory handle on Windows.
- Preserve the package-reachable directory helper signatures while adding an
  injectable platform callback and shared exported policy symbols.
- Keep normal transaction recovery-required diagnostics and make actionable
  recovery-time directory-sync failures report unsafe recovery with inventory.
- Add deterministic injected tests for accepted Windows sync failures and
  rejected non-Windows, non-allowlisted, open, and close failures.
- Document the Windows-only exception and fail-closed filesystem remediation.

## Verification

- Validate requirements, design, and constitution.
- Record genuine focused Red/Green evidence.
- Run typecheck, build, full tests, package checks, strict trace, Code Graph,
  changed gate, and status.

## Residual risks

- Windows cannot guarantee directory-entry crash durability where the
  allowlisted directory-handle sync operation is unsupported.
- No other filesystem failure is treated as a capability limitation.
