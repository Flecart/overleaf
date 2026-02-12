# AI Tutor — Multi-Agent Paper Review System

## Overview

The AI Tutor is an Overleaf plugin that provides automated paper review using a multi-agent architecture. It analyzes the full project structure, classifies the paper type, and runs parallel reviewer subagents — each specialized in a different aspect of academic writing — then posts inline comments to the Overleaf review panel.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React)                      │
│  ai-tutor-panel.tsx                                      │
│  ┌────────────┐  ┌──────────┐  ┌───────────────────┐   │
│  │ Model      │  │ Run Full │  │ Apply Comments to │   │
│  │ Dropdown   │→ │ Review   │→ │ Current Document  │   │
│  └────────────┘  └──────────┘  └───────────────────┘   │
└──────────────────────┬──────────────────────────────────┘
                       │
                  POST /ai-tutor-review
                       │
┌──────────────────────▼──────────────────────────────────┐
│                    Backend (Node.js)                      │
│  ChatController.mjs — reviewWholeProject()               │
│  ┌──────────────────────────────────────────────────────┐│
│  │ 1. Inline-expand all \input/\include → merged.tex    ││
│  │ 2. Categorize files → metadata.json                  ││
│  │ 3. Call AiTutorReviewOrchestrator.runFullReview()     ││
│  │                                                      ││
│  │  Phase 0: parseSections()     — regex, no LLM        ││
│  │  Phase 1: classifyPaper()     — 1 LLM call           ││
│  │  Phase 2: runSubagent() × 10  — parallel LLM calls   ││
│  │  Phase 3: mapCommentsToDocuments() — string matching  ││
│  └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

The frontend has a single "Run Full Review" button. When clicked, the backend performs project structure analysis (merging TeX files, categorizing project files) and then runs the full multi-agent review pipeline — all in one HTTP request.

## Pipeline Phases

### Phase 0 — Section Parsing (regex, no LLM)

Parses `merged.tex` into a structured list of sections using regex:
- Extracts `\begin{abstract}...\end{abstract}`
- Finds all `\section{}`, `\subsection{}`, `\subsubsection{}` headers
- For each header, captures the content until the next same-or-higher-level header
- Returns: `{ title, level, content, charStart, charEnd }[]`

**Design choice**: Regex is deterministic, free, and fast. LLM section parsing would be unreliable and unnecessary since LaTeX sections are well-structured.

### Phase 1 — Paper Type Classification + Section Assignment (1 LLM call)

Uses `generateObject()` with a Zod schema to classify the paper and produce:
1. **paperType** — one of: `analysis`, `dataset`, `method_improvement`, `llm_engineering`, `llm_inference_findings`, `css`, `position`, `other`
2. **sectionAssignments** — an array with one entry per section: `{ sectionTitle, category }`. Every section from Phase 0 must appear exactly once, ensuring complete coverage. Categories are: `abstract`, `introduction`, `related_work`, `methods`, `results`, `conclusion`. After the LLM responds, `buildSectionMapping()` inverts this into the category→titles map the subagents expect, and a safety-net fallback assigns any sections the LLM missed using keyword heuristics.
3. **typeSpecificGuidance** — dynamically generated review criteria for each subagent, specific to this paper type

The classifier receives the **full abstract**, **full introduction**, the section outline, and a numbered list of all sections to assign. All 7 paper type skill files from `02_paper_types/` are loaded into the system prompt. No content is pre-truncated — if the input exceeds the model's context window, `generateObjectWithRetry()` automatically retries with progressively shorter prompts (see [Context Length Handling](#context-length-handling)).

**Design choice**: Per-section assignment (section→category) instead of per-category arrays (category→sections) ensures no section is accidentally left unreviewed. The LLM must produce an assignment for every section in the numbered list.

**Design choice**: The section mapping is produced by the LLM (not hardcoded regex) because section titles vary wildly across papers (e.g., "RQ1: How Can Training Equip Models..." is a results section, but regex wouldn't know that). The LLM sees the outline and classifies each section correctly.

**Design choice**: Type-specific guidance is generated dynamically rather than using fixed templates, because the Phase 1 LLM can tailor criteria to the specific paper (e.g., for a dataset paper about crowdsourcing, it might emphasize IAA reporting, while a dataset paper about web scraping would emphasize licensing).

### Phase 2 — Parallel Reviewer Subagents (10 LLM calls)

All 10 subagents run concurrently via `Promise.allSettled()` with 2-minute timeouts:

| # | Agent | Input | Skills |
|---|-------|-------|--------|
| 1 | Abstract Reviewer | Abstract section | `abstract.md` |
| 2 | Introduction Reviewer | Introduction section | `introduction.md` |
| 3 | Related Work Reviewer | Related work section | `related_work.md`, `citations_and_references.md` |
| 4 | Methods Reviewer | Methods sections | `methods.md`, `task_formulation.md`, `math_and_formulas.md` |
| 5 | Results Reviewer | Results/experiments sections | `results_and_analysis.md` |
| 6 | Conclusion Reviewer | Conclusion + limitations | `conclusion.md`, `limitations.md`, `ethical_considerations.md`, `faq_appendix.md` |
| 7 | Writing Style Reviewer | Full document | `grammar_and_punctuation.md`, `capitalization_and_acronyms.md`, `general_writing_habits.md` |
| 8 | LaTeX Formatting Reviewer | Full document | `latex_formatting.md`, `math_and_formulas.md`, `table_formatting.md` |
| 9 | Figures & Captions Reviewer | Extracted figure/table environments + context | `caption_writing.md`, `figure1_design.md`, `experiment_visualization.md` |
| 10 | Structure Reviewer | Paper skeleton (titles + first sentences) | `general_writing_habits.md` |

Each subagent receives:
- **System prompt**: Skill file content + type-specific guidance from Phase 1
- **User prompt**: The full relevant text (no pre-truncation)
- **Output**: Structured JSON via `generateObject()` + Zod schema

Each comment has: `{ highlightText, comment, severity }` where `highlightText` is an exact verbatim quote (20-200 chars) from the paper.

**Design choice**: `generateObject()` with Zod schemas is used instead of raw JSON parsing. This ensures the LLM output always conforms to the expected structure — no fragile regex/JSON extraction from free-text responses.

**Design choice**: Section-specific agents receive only their section's text (not the whole paper) to focus the LLM's attention. Full-document agents (writing style, LaTeX) receive the entire `merged.tex`. If any call exceeds the context window, `generateObjectWithRetry()` handles it automatically.

**Design choice**: `Promise.allSettled()` (not `Promise.all()`) ensures that if one agent fails or times out, the others still complete successfully.

### Phase 3 — Comment Position Mapping

Maps each comment's `highlightText` back to the correct original source file:

1. **Build inline map** from `% ========== INLINED FROM: ... ==========` markers in merged.tex
2. **Find `highlightText`** in merged.tex to determine the merged position
3. **Use inline map** to find which original file that position belongs to
4. **Search for `highlightText`** in the original file to get the true offset
5. **Fallback**: If the direct mapping fails, search all documents for the text

**Design choice**: Text search (not character offsets from the LLM) is used because LLMs cannot reliably count characters. The `highlightText` approach is robust — the LLM quotes exact text, and we search for it.

**Design choice**: Fallback to searching all documents handles edge cases where the inline map doesn't perfectly align (e.g., text near INLINED FROM markers).

## Context Length Handling

All LLM calls go through `generateObjectWithRetry()`, which sends full content on the first attempt. If the OpenAI API returns a context-length-exceeded error (detected by matching `context_length_exceeded`, `maximum context length`, `exceeds the context window`, or `maximum number of tokens` in the error message), it retries with progressively truncated prompts:

1. **Attempt 1**: Full prompt (100%)
2. **Attempt 2**: Truncated to 50% (first half + last half with `[... truncated ...]` marker)
3. **Attempt 3**: Truncated to 25%

Non-context errors are thrown immediately without retry.

**Design choice**: Always send full content first, only truncate on actual context length errors. This ensures the LLM sees as much of the paper as possible. Different models have different context windows, so hardcoded limits would be fragile.

## Comment Application (Frontend)

The frontend applies comments using Overleaf's ShareJS/OT comment system:

1. Gets the current document snapshot via `currentDocument.getSnapshot()`
2. For each comment, searches for `highlightText` via `indexOf()`
3. Creates a thread via `POST /project/{id}/thread/{threadId}/messages`
4. Applies the comment operation: `{ c: highlightText, p: position, t: threadId }`

Comments are applied to whichever document is currently open. Since the main .tex file typically contains most of the paper content (with `\input` used for figures/tables/preamble), most comments will match the root document. Users can switch to other files and click "Apply Comments" again to apply remaining comments.

## Logging

All procedural progress is logged to the web container's stdout (viewable via `docker compose logs web`). Logs use the `[AI Tutor]` prefix throughout. Key log points:

### Per-phase timing
- Overall start/end banners with `=====` separators, including project ID, model, merged.tex size, docContentMap files
- Phase separators with `-----`, each phase logs elapsed time
- Final summary: per-phase timing breakdown, total elapsed

### Phase 0
- Each parsed section: level, title, char count, position range

### Phase 1
- Abstract/introduction found + content length
- Numbered section list being assigned
- Skill context size
- LLM call: attempt number, system/prompt sizes, elapsed time, response preview (first 200 chars)
- Per-section assignment result: `"section title" => category`
- Final section mapping per category
- Fallback assignments (sections the LLM missed, assigned via keyword heuristics)

### Phase 2
- Per agent: starting, text source + size, system prompt size, skill files loaded
- Per agent LLM call: attempt, sizes, elapsed time, response preview
- Per agent validation: X/Y comments kept, discarded comments with highlightText + comment preview
- Per agent: each validated comment (severity, highlightText preview, comment preview)
- Overall: all agents returned, per-agent status (OK/SKIPPED/FAILED), total raw comments

### Phase 3
- Inline map region details (file, char ranges)
- Per-comment warnings: not found in merged.tex, fallback to other file, unmapped
- Summary: direct/fallback/notFoundInMerged/unmapped counts

### Helpers
- Skill file loading: file name + size on success, warning on failure
- Skill directory loading: file count + names
- `generateObjectWithRetry`: before/after each attempt with sizes, elapsed time, response preview; context length retries with truncation percentages; failures with error messages
- `collectSectionContent`: warns on fuzzy fallback (no exact match) or no match at all

## File Reference

All paths are relative to `/home/ubuntu/.jiarui/overleaf/`.

### Backend — Agent Orchestration

- **[`services/web/app/src/Features/Chat/AiTutorReviewOrchestrator.mjs`](services/web/app/src/Features/Chat/AiTutorReviewOrchestrator.mjs)**
  The core multi-agent engine. Contains:
  - `parseSections(mergedTex)` — Phase 0: regex-based LaTeX section parsing
  - `generateObjectWithRetry(options, label)` — wrapper around `generateObject()` that retries with progressively truncated prompts on context-length-exceeded errors. Logs before/after each attempt with sizes, elapsed time, and response preview
  - `classifyPaper(openai, model, sections)` — Phase 1: LLM paper type classification, per-section assignment to reviewer categories, dynamic guidance generation
  - `buildSectionMapping(sectionAssignments, sections)` — converts per-section LLM assignments into category→titles map, with fallback heuristics for any sections the LLM missed
  - `runSubagent(...)` — runs a single reviewer subagent with skill files, section text, and type-specific guidance
  - `SUBAGENT_DEFS` — the 10 subagent definitions (id, skills, section categories, system preamble, `textOnly` flag for future multimodal)
  - `extractFigureTableEnvironments(mergedTex)` — extracts `\begin{figure}` / `\begin{table}` environments with surrounding context for the Figures & Captions reviewer
  - `buildSkeleton(sections)` — builds section titles + first sentences for the Structure reviewer
  - `mapCommentsToDocuments(...)` — Phase 3: maps `highlightText` strings back to original source files using the `% ========== INLINED FROM: ... ==========` markers
  - `runFullReview({...})` — main entry point that orchestrates all 4 phases

### Backend — Route Handlers

- **[`services/web/app/src/Features/Chat/ChatController.mjs`](services/web/app/src/Features/Chat/ChatController.mjs)**
  Express route handlers for all AI Tutor endpoints:
  - `reviewWholeProject` — the main endpoint. Gathers all project docs/files, finds root doc, inline-expands `\input`/`\include`, categorizes files into 5 categories, writes `merged.tex` + `metadata.json` to cache, then calls `runFullReview()` from the orchestrator. Returns review results with `metadata` attached so the frontend can display file details.
  - `analyzeWholeProject` — standalone project analysis endpoint (same logic as the first half of `reviewWholeProject`, kept for backward compatibility)
  - `logAITutorSuggestions` — logs AI tutor activity to daily JSONL files
  - `sendThreadMessage` — posts a thread message and emits `new-comment` socket event for real-time UI updates

### Backend — Route Definitions

- **[`services/web/app/src/router.mjs`](services/web/app/src/router.mjs)** (lines ~1076–1098)
  Defines the AI Tutor HTTP endpoints:
  - `POST /project/:project_id/ai-tutor-log` → `ChatController.logAITutorSuggestions`
  - `POST /project/:project_id/ai-tutor-analyze` → `ChatController.analyzeWholeProject`
  - `POST /project/:project_id/ai-tutor-review` → `ChatController.reviewWholeProject`
  All routes are protected by `blockRestrictedUserFromProject` + `ensureUserCanReadProject` middleware.

### Backend — Skill Library

- **[`services/web/app/src/Features/Chat/ai-tutor-skills/`](services/web/app/src/Features/Chat/ai-tutor-skills/)**
  31 markdown skill files organized in 5 directories. Loaded at review time by the orchestrator and injected into subagent system prompts.
  - [`CONTENTS.md`](services/web/app/src/Features/Chat/ai-tutor-skills/CONTENTS.md) — master index with modality tags (`[TEXT]` vs `[MULTIMODAL]`)
  - [`01_setup/`](services/web/app/src/Features/Chat/ai-tutor-skills/01_setup/) — prototype paper search strategies (2 files)
  - [`02_paper_types/`](services/web/app/src/Features/Chat/ai-tutor-skills/02_paper_types/) — 7 paper type definitions (analysis, dataset, method_improvement, llm_engineering, llm_inference_findings, css, position). All loaded into Phase 1 classifier.
  - [`03_paper_sections/`](services/web/app/src/Features/Chat/ai-tutor-skills/03_paper_sections/) — 10 section-specific writing guides (abstract, introduction, task_formulation, related_work, methods, results_and_analysis, conclusion, limitations, ethical_considerations, faq_appendix). Loaded per-subagent based on which sections they review.
  - [`04_figures_and_tables/`](services/web/app/src/Features/Chat/ai-tutor-skills/04_figures_and_tables/) — 6 visual element guides (figure1_design, experiment_visualization, color_palettes, data_visualization, table_formatting, caption_writing). Loaded by Figures & Captions reviewer.
  - [`05_writing_style/`](services/web/app/src/Features/Chat/ai-tutor-skills/05_writing_style/) — 6 formatting and language guides (grammar_and_punctuation, citations_and_references, latex_formatting, math_and_formulas, capitalization_and_acronyms, general_writing_habits). Loaded by Writing Style, LaTeX Formatting, and Structure reviewers.

### Frontend — Service Layer

- **[`services/web/frontend/js/features/editor-left-menu/utils/ai-tutor-service.ts`](services/web/frontend/js/features/editor-left-menu/utils/ai-tutor-service.ts)**
  TypeScript API functions and type definitions:
  - `runFullReview(projectId, model)` — calls `POST /ai-tutor-review`, returns `ReviewResult` with `commentsByDoc`, `summary`, `classification`, `failedAgents`, `metadata`
  - Type interfaces: `WholeProjectMetadata`, `FileCategory`, `ReviewComment`, `ReviewResult`

### Frontend — UI Panel

- **[`services/web/frontend/js/features/ide-redesign/components/ai-tutor/ai-tutor-panel.tsx`](services/web/frontend/js/features/ide-redesign/components/ai-tutor/ai-tutor-panel.tsx)**
  The React component for the AI Tutor sidebar panel. Contains:
  - **Model dropdown** — lets user select GPT-4o, GPT-4o-mini, GPT-4.1, GPT-4.1-mini
  - **"Run Full Review" button** (`handleFullReview`) — triggers the combined project analysis + multi-agent review in one call. Shows progress message during the request, then displays review summary (paper type, comments by category/severity/document, skipped agents)
  - **"Apply Comments" button** (`handleApplyComments`) — applies review comments to the currently open document by searching for each `highlightText` via `indexOf()`, creating thread via `postJSON`, and applying `CommentOperation` via `currentDocument.submitOp()`
  - **Review summary** (collapsible) — paper type, comments by category/severity/document, failed agents
  - **File details** (collapsible) — extracted from `metadata` in the review response: TeX files, figures, bib files, merged char count

### Configuration & Infrastructure

- **[`.env`](.env)** (gitignored)
  Stores `OPENAI_API_KEY=sk-...`. Read by docker-compose and passed into the web container.

- **[`develop/docker-compose.yml`](develop/docker-compose.yml)**
  Docker Compose configuration. AI Tutor additions:
  - `env_file: ../.env` on the web service to forward `OPENAI_API_KEY`
  - Volume mounts: `./ai-tutor-cache:/var/lib/overleaf/ai-tutor-cache` and `./ai-tutor-logs:/var/lib/overleaf/ai-tutor-logs`

### Runtime Cache (generated, not committed)

- **`develop/ai-tutor-cache/{projectId}/`** — per-project cache directory
  - `merged.tex` — all .tex files inlined via recursive `\input`/`\include` replacement, with `% ========== INLINED FROM: ... ==========` markers
  - `metadata.json` — project name, root doc path, file categorization (tex, figures, bib, useful, irrelevant), merged tex length
  - `review_comments.json` — cached output of the full review: classification, commentsByDoc, summary, failedAgents

- **`develop/ai-tutor-logs/`** — daily JSONL log files (`ai-tutor-YYYY-MM-DD.jsonl`) recording each AI tutor invocation with timestamps, suggestions, and model info

## API Endpoints

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `/project/:id/ai-tutor-review` | `reviewWholeProject` | Analyzes project + runs full multi-agent review |
| POST | `/project/:id/ai-tutor-analyze` | `analyzeWholeProject` | Standalone project analysis (backward compat) |
| POST | `/project/:id/ai-tutor-log` | `logAITutorSuggestions` | Log AI suggestions to disk |

## Configuration

### API Key

Store your OpenAI API key in `/.env` (gitignored):
```
OPENAI_API_KEY=sk-...
```

Passed to the web container via `env_file: ../.env` in `docker-compose.yml`.

### Model Selection

Users select the model from a dropdown in the AI Tutor panel. Options:
- GPT-4o (default, best quality)
- GPT-4o Mini (faster, cheaper)
- GPT-4.1
- GPT-4.1 Mini

## Robustness

| Failure Mode | Mitigation |
|---|---|
| LLM returns malformed output | `generateObject()` with Zod schema enforces structure |
| Subagent timeout | `Promise.race()` with 2-minute timeout per agent |
| One agent fails | `Promise.allSettled()` — other agents continue |
| `highlightText` not found in doc | Comment skipped with console warning |
| API rate limit | Failed agents reported in `failedAgents` array |
| Input exceeds context window | `generateObjectWithRetry()` retries with 50%, then 25% of prompt |
| No matching sections for an agent | Agent skipped gracefully with reason |
| Section not assigned by LLM | `buildSectionMapping()` fallback assigns via keyword heuristics |
| Section title fuzzy mismatch | `collectSectionContent()` falls back to partial string matching |
| Skill file not found | Logs warning, continues with placeholder text |

## Multimodal Interface (Future)

Each subagent definition has a `textOnly: boolean` field. Currently all agents are text-only. The `04_figures_and_tables/` skills have `[MULTIMODAL]` tags. When multimodal support is added:
1. Set `textOnly: false` on the Figures & Captions Reviewer
2. Pass compiled PDF page images alongside the LaTeX source
3. The agent can then review actual figure appearance, color palettes, chart types, etc.

## Dependencies

- **Vercel AI SDK** (`ai` v6.0.2) — `generateObject()` for structured LLM output
- **@ai-sdk/openai** (v3.0.0) — OpenAI provider with `createOpenAI({ apiKey })`
- **zod** — Schema validation for LLM output structure
