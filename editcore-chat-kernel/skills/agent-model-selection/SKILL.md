---
name: agent-model-selection
description: Deliberately select and justify the model before spawning any sub-agent. Use for every delegated task in this repository or when choosing among Codex agent models, especially implementation, audits, security, production, finance, deployment, and validation work.
---

# Agent Model Selection

Select the model before creating a sub-agent. Do not default to a model by habit.

## Required Launch Note

Write this note in the orchestration message before the agent is created:

    Model selected: <model>
    Reason: <why this model fits the task>
    Tradeoff: <speed/cost/risk tradeoff>

The note is mandatory even when the task is small.

## Selection Matrix

| Model | Use when | Avoid when |
| --- | --- | --- |
| gpt-5.4-mini | Cheap or simple archive work, status checks, formatting, small documentation cleanup, and low-risk summaries. | Multi-file implementation, security, finance, referrals, production, or pull-request validation. |
| gpt-5.4 | Moderate single-slice documentation or test maintenance with low risk and small context. | High-risk architecture, production readiness, finance, authentication, referrals, deployment, or runbook verification. |
| gpt-5.5 | Reliable general baseline for SDD planning, implementation, and verification when no specialized advantage applies. | Do not choose automatically before checking whether Luna, Terra, or Sol better fits. |
| gpt-5.6-luna | Fast bounded edits, narrow code reading, and quick test fixes where speed or cost matters. | Broad audits, high-stakes safety gates, or complex multi-file work. |
| gpt-5.6-terra | Balanced multi-file implementation, documentation plus tests, and safety-sensitive work that is not final production critical. | Final adversarial verification of live production or major architecture decisions needing maximum depth. |
| gpt-5.6-sol | Highest-risk architecture, production go/no-go verification, incident/root-cause audits, finance, security, deployment, and expensive-to-reverse decisions. | Routine documentation or test work where Terra or 5.5 is sufficient. |

## Decision Workflow

1. Classify the task by risk, scope, reversibility, and required context.
2. Check whether the task is documentation, narrow code, multi-file implementation, security-sensitive, production-critical, or adversarial verification.
3. Select the least expensive model that still provides adequate reliability; upgrade when the cost of an error is high.
4. State the selected model, reason, and tradeoff before creating the sub-agent.
5. Give the sub-agent a bounded task and disjoint write scope. Do not delegate the immediate blocking task.
6. Review the sub-agent result and verify its artifacts independently.

## SDD Guidance

Use gpt-5.5 as a baseline only after checking the specialized options. Upgrade deliberately for high-risk or multi-file work. Prefer gpt-5.6-terra for implementation slices involving documentation, tests, and runbooks. Prefer gpt-5.6-sol for final production verification and adversarial review.

## Guardrails

- Never spawn a sub-agent without a deliberate model choice.
- Never hide the model choice, rationale, or tradeoff from the orchestration message.
- Do not use a fast or cheap model for work whose failure would affect security, authentication, finance, deployment, production, or irreversible data.
- Do not claim that model selection is complete until the launch note exists and the selected model is actually passed to the agent runtime.

