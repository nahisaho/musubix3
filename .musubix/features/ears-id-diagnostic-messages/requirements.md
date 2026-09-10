---
schemaVersion: 1
feature: ears-id-diagnostic-messages
---
# EARS and requirement-ID diagnostic message improvements

Source: GitHub Issues #2, #3, #4, found during a real multi-language trial
project against musubix3@0.1.11. All three are UX-only gaps in
`packages/domain/src/requirements.ts`: the tool's classification/validation
behavior is already correct, but the diagnostic messages it emits on
rejection do not name the specific problem or show a concrete example,
forcing authors to guess.

## REQ-EARS-ID-DIAGNOSTIC-MESSAGES-001: Name a pronoun/bare subject and show a valid example
Priority: must
Type: functional
Pattern: event-driven
Statement: When a requirement statement's subject uses a pronoun or a bare noun instead of an explicit article-led noun phrase, the system shall include a valid-subject example in the REQ_EARS diagnostic message.
Acceptance: Given a statement such as "When an event occurs, it shall respond.", the REQ_EARS diagnostic identifies the offending subject text and includes an example of a valid subject (for example, "the <system/component> shall ...").

## REQ-EARS-ID-DIAGNOSTIC-MESSAGES-002: Name the specific clause forms being mixed
Priority: must
Type: functional
Pattern: event-driven
Statement: When a requirement statement's clause prefix combines an if-then clause with a state-or-event clause, the system shall name the specific clause forms being combined in the REQ_EARS diagnostic message.
Acceptance: Given a statement such as "While the alarm is active, if a fault occurs, then the system shall stop.", the REQ_EARS diagnostic states that an "if ..., then" clause cannot be combined with a "while"/"when"/"where" clause in one statement, naming the specific clause keywords found.

## REQ-EARS-ID-DIAGNOSTIC-MESSAGES-003: State the expected requirement-ID pattern
Priority: must
Type: functional
Pattern: event-driven
Statement: When a requirement ID's final segment is not purely numeric, the system shall state the expected identifier pattern in the REQ_ID diagnostic message.
Acceptance: Given a requirement heading with an ID such as REQ-LOGI-008B, the REQ_ID diagnostic states the expected pattern REQ-FEATURE-digits (numeric-only final segment) alongside the rejected ID.
