---
name: agent-reach
description: >-
  Advanced external reach, structured web research, live website inspection, API orchestration,
  and multi-source intelligence gathering. Use when agents need deep web access, scraping, or external discovery.
---

# Agent Reach & Web Intelligence Skill

This skill enables agents to interact with the broader web, extract structured information, and perform multi-source research.

## 1. Web Inspection & Research Strategy
- **Step 1: Broad Query Identification**: Formulate targeted search terms to locate official documentation, changelogs, and real-time data.
- **Step 2: Structured Extraction**: When extracting data from web pages, parse semantically (JSON-LD, OpenGraph tags, headings `<h1>-<h6>`, markdown structures).
- **Step 3: Verification & Cross-Referencing**: Validate data against multiple sources before adopting assumptions.

## 2. API Integration & Service Verification
- Probe endpoints cleanly using `HEAD` or lightweight `GET` requests with strict timeouts (`10s - 15s`).
- Handle rate-limiting (HTTP 429) with exponential backoff and jitter.
- Always redact sensitive headers, authorization tokens, and private keys from logs.

## 3. Resilient Scraping Best Practices
- Respect `robots.txt` and domain terms.
- Use headless browser rendering only when JavaScript client-side execution is mandatory.
- Normalize output to Markdown or structured JSON for agent reasoning.
