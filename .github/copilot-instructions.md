# Copilot Instructions

## Data Safety (Critical)
- Never reset any database unless the user explicitly asks for it in the current conversation.
- Treat all production and staging data as critical: avoid destructive data operations by default.
- Before any migration, cleanup, or schema change that could remove data, require explicit user confirmation in the prompt.
- Prefer additive, backward-compatible changes and reversible migrations.
- If a requested action is ambiguous and could cause data loss, stop and ask for clarification.
