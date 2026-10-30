# FADE IN: Screenplay Writer

### From an idea or an existing document to a screenplay you can shape.

**AI-assisted screenplay writing · Source-based adaptation · Style guidance · Saved progress**

Screenplay Writer brings drafting, adaptation, revision, and generation controls into one focused workspace. Start with a premise, work from an existing text, supply a style sample, and watch your screenplay take shape.

---

## Overview

Good writing needs more than a prompt box. It needs room for the original material, clear instructions, a direction for the voice, and a way to revise without starting over.

Screenplay Writer separates those inputs so you can tell the system what to write, what material to draw from, and how you want it to sound. DeepSeek powers the writing; Neon PostgreSQL saves the intermediate work behind longer jobs.

Two dedicated tabs keep the workflow straightforward: **Write from scratch** and **Adapt existing text**. Both support optional style samples, reference material, editable output, and follow-up revisions.

---

## Who It's For

- **Screenwriters** developing premises, scenes, dialogue, and working drafts.
- **Authors and storytellers** adapting prose or existing narratives into screenplay form.
- **Filmmakers and independent creators** exploring a story before production.
- **Researchers and nonfiction writers** using supplied documents as the basis for a dramatic adaptation.
- **Writers who want control** over the brief, source material, revisions, and when generation stops.

---

## Core Capabilities

| Capability | What you can do |
| --- | --- |
| **Write from scratch** | Describe the story, setting, characters, tone, and desired length in your own words. |
| **Adapt existing text** | Paste or upload an original document and explain how it should become a screenplay. |
| **Guide the style** | Supply a separate writing sample to guide the voice of the draft. |
| **Supply reference material** | Add notes, research, or facts separately from the style sample. |
| **Upload documents** | Bring in TXT, Markdown, PDF, or DOCX files up to 8 MB, subject to the extracted-text limits. |
| **Watch the writing** | Follow live output in a movable, resizable window that can also collapse or minimize. |
| **Revise the current draft** | Give follow-up instructions instead of rebuilding the original request. |
| **Edit and export** | Edit the output, copy it, or download it as a plain-text file. |
| **Recover saved work** | Retain browser drafts and use database checkpoints to resume an interrupted writing job. |

---

## Stay in Control

### Suspend and save

Pause generation and save the output already produced. The saved text is available to copy or download, and the suspended job can be recovered after a reload.

Resume continues from the last completed checkpoint. An unfinished section may be rewritten; the saved snapshot is retained separately.

### Stop and start again

Stop a generation without erasing your instructions. Start a fresh run when you are ready, or use **Stop and start again** to combine the two actions.

### Erase only what you choose

**Erase everything in this tab** removes that tab's inputs, outputs, and associated saved writing jobs while leaving the other tab intact.

**Erase everything on this page** resets both tabs and reloads the page. Both erase actions stop the associated generation and remove its tracked database checkpoints. They act immediately, without a confirmation dialog.

---

## What Makes It Different

- **Separate controls for content and style.** Your source document, supporting material, style sample, and instructions have distinct places in the workflow.
- **Adaptation alongside original writing.** Develop a new story or work from material you already have without switching applications.
- **Visible work in progress.** Follow the text as it appears, rather than waiting for a finished response with no visibility into the process.
- **Saved partial writing.** An unfinished draft can still be useful. Saving and downloading it do not require final coherence approval.
- **Continuity-aware long-form processing.** Longer jobs use a shared plan, saved section drafts, continuity records, and consistency audits—not merely independent short responses joined together.
- **An honest completion standard.** Drafts that fail the length or coherence checks remain marked incomplete rather than being presented as finished screenplays.

---

## How It Works

1. **Choose your starting point.** Write from scratch or adapt an existing document.
2. **Set the brief.** Describe the result you want, including the approximate word count.
3. **Add optional guidance.** Supply a style sample and any supporting material.
4. **Generate and review.** Watch the writing, suspend and save it, or stop and restart.
5. **Refine and keep the result.** Edit the output, request a revision, copy it, or download a text file.

If no length is specified, the default is approximately **1,000 words**.

---

## Long-Form Writing: Current Status

**Long-form generation is experimental.**

The app accepts source documents up to **30,000 words per source field** and writing requests up to **30,000 words**. Its longer-writing workflow saves source sections, a global plan, generated sections, continuity updates, and audit findings in Neon.

**Verified:** lossless intake of a 30,000-word text document; live generation; checkpoint recovery; suspension with an exact matching text download; stop/restart; and scoped erasure.

**Not yet verified:** dependable, coherent completion of a 30,000-word screenplay. Real multi-section trials have reached the requested length range but still failed continuity checks after automatic repairs. The app preserves that work as an incomplete, resumable draft.

The supported request limit is not a guarantee of final length, narrative quality, or successful audit approval. Review generated work before using or sharing it.

---

## Built With

**DeepSeek** for generation · **Neon PostgreSQL** for writing checkpoints · **React and TypeScript** for the interface · **Express** for the API

Operational and project setup notes are available in [replit.md](replit.md).

---

**Start with a premise. Bring your source material. Keep control of the draft.**
