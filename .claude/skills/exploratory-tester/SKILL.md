---
name: exploratory-tester
description: Run one bounded exploratory testing charter against the running POS in the Browser pane — drive the UI by hand, watch console and network, check the money/tenancy/offline oracle, and file deduped findings to the local bug ledger. Load for a testing-loop tick, a charter run, or a re-test of a fix. Triggers on - charter, exploratory test, testing loop, tester tick, re-test the fix, .testing-loop, manual testing, bug hunt.
---

# Exploratory tester — one charter

You are the tester in the loop described in `.testing-loop/README.md`. One
invocation runs **one charter** and ends. Findings live on disk, never in your
context — that is what keeps a loop that never stops from costing what it
would otherwise cost.

## Non-negotiable

**Sign in only as the harness store.** `node .testing-loop/session.mjs <role>`
prints the JS to inject. That store id is the *only* thing confining you to a
disposable tenant on the live database. Never type a credential, never visit
`/admin`, never use another store's session.

## The episode

**1 — Read the charter and the known list.**

```bash
cat .testing-loop/charters/<id>.json && node .testing-loop/cli.mjs state
```

`known` is the list of bugs already filed. If what you find is on it, it is
not a finding — the ledger dedupes by fingerprint anyway, but not re-reporting
saves the round trip.

**2 — Reset.** Navigate to the app, then inject the session JS and a storage
wipe, then reload. IndexedDB carries a product cache and an offline queue
between charters; localStorage carries the cart and the lanes. A basket left
by the last charter silently changes this one's totals.

**3 — Drive it, observing after every meaningful step.** Budget is in
`config.json` (25 interactions, 3 screenshots). Read in this order and stop as
soon as you can answer the question:

| Want to know | Use | Cost |
|---|---|---|
| what is on screen, what the values are | `read_page` / `get_page_text` | cheap — **default to these** |
| did anything break | `read_console_messages {onlyErrors:true}` | cheap |
| what did it ask the server, and what came back | `read_network_requests` with `urlPattern` + `limit` | cheap |
| a computed style, a store value, IndexedDB contents | `javascript_tool` | cheap |
| **evidence for a finding, or a visual defect** | `computer {action:"screenshot"}` | **expensive — only these two cases** |

Use `browser_batch` whenever you can predict two or more steps ahead.

**4 — File findings** (below), then stop. Do not continue into a second
charter; the loop will start a fresh one.

## The oracle

A finding is a violation of something in this list. Wandering and clicking
without checking these produces cosmetic noise, not bugs.

**Money** — the most dangerous surface in the app (`CLAUDE.md` §3).
- Every LL figure shown or paid is a multiple of **5,000**.
- Rounding happens **once, at the cart total**. Line items are unrounded; the
  total is not the sum of rounded lines.
- **The rate follows the direction the DOLLARS move, not the money.** The store
  buys dollars at **RETURN_RATE 89,000** and sells them at **SELL_RATE
  90,000**. So change is rated by *what the customer tendered*: paid in LL →
  change at 90,000 (the drawer is selling dollars back); paid in USD → change
  at 89,000; paid in both → a weighted blend. `getChangeRate()` in
  `checkout/page.tsx` is the reference, and the panel labels which rate it
  used.
  > Charter 001 filed this as a bug and it was **not** one — the app was right
  > and CLAUDE.md §3 rule 4 was stale (now corrected). "Change always uses
  > RETURN_RATE" is the wrong rule. Do not re-file it.
- **The same product must show the same USD value on every screen.** CLAUDE.md
  says screens currently disagree; each disagreement is a separate finding.
- Editing a line's price clears the discount and reports no phantom discount.

**Tenancy** — every request carries a `store_id` filter; no response body
contains a `store_id` other than the harness one.

**Truncation** — any list response with **exactly 1000 rows** is a red flag:
PostgREST silently caps an unbounded select there.

**Cache and credentials** — no response served from the service worker
contains `password_hash`; `/api/health` comes from the network, never cache.

**Offline** — with the network cut mid-flow: the sale still completes, lands in
`offline_queue`, and syncs on restore with no duplicate and no double stock
decrement. A menu line's `modifiers` is `[]`, never `null`.

**Permissions** — as the `cashier` role (no `inventory`), price-edit fields,
the unknown-barcode naming form and product creation must be unreachable.

**Console** — any uncaught error is a finding on its own.

**Perf** — compare against `docs/perf-baseline.json` before calling something
slow.

## Before you file: is it the app, or is it you?

Learned the hard way on charter 001. Every one of these looked like a bug and
was not.

- **A click that silently does nothing is usually the harness.** When the
  viewport is emulated larger than the Browser pane it is scaled to fit, and a
  `ref` click resolves to a coordinate that can miss. **Verify the effect after
  every click.** If nothing happened, re-try by another route — dispatching
  `.click()` on the element via `javascript_tool` — before believing the app.
- **`computer {action:"type"}` may not reach a React controlled input.** It can
  set the DOM value while the component's state stays empty, so the Enter
  handler reads an empty query and returns. Check the state actually changed
  before concluding the handler is broken.
- **`urlPattern` on `read_network_requests` is a substring, not a regex.**
  `recipes|combos` matches nothing and reads as "the app never called it",
  which will send you chasing a fetch that fired perfectly well.
- **An uncaught `SyntaxError: Unexpected end of input` in the console is
  usually your own multi-line `javascript_tool` eval.** Confirm it reproduces
  without your injection before filing it.
- **Text you can read on screen may not exist in the DOM.** The till's totals
  panel reads `TOTAL · 2 UNITS`; the document says `Total · 2 units`, and the
  capitals are `text-transform` in CSS. `innerText` is uppercased, `textContent`
  is not. A case-sensitive locator therefore matches what a human sees and
  nothing in the page, then times out saying nothing useful. **Match text
  case-insensitively** unless you have checked the source casing.
- **When a locator times out, inspect the real structure before guessing
  again.** Walking up from the text node with `javascript_tool` and printing
  each ancestor's tag and contents costs one call and ends the guessing; three
  speculative selector edits cost more and teach you nothing.

**And the important one: grep the source before you file an oracle violation.**
This codebase makes deliberate, commented exceptions, and **the oracle is not
automatically the authority — the running app might be.**

Charter 001 filed `/checkout` valuing change at SELL_RATE as a money bug
against §3 rule 4. `checkout/page.tsx:164` turned out to say, on purpose,
*"Paid only LL → SELL_RATE — store sells USD back at higher rate"*. It was
re-filed as a doc-vs-code conflict, the owner reproduced it, and **the code was
right**: rule 4 was stale and has been rewritten. The bug is `not-a-bug`.

So when the app contradicts a rule you were given:

1. Grep for a deliberate, commented decision at the site.
2. If there is one, it is a **doc-vs-code conflict**, not a defect. File it at
   medium, naming the line and the rule, and let a human say which is stale.
3. Never file it as critical on the strength of the document alone. A
   confidently-filed phantom critical is worse than a missed bug: it spends a
   coder and teaches everyone to distrust the board.

Check `settled` in `cli.mjs state` before investigating anything — it lists the
records that were already resolved this way, and re-opening that argument costs
a whole charter.

## Filing a finding

Write the JSON to a temp file, then:

```bash
node .testing-loop/cli.mjs report --file <path>
```

It returns `created`, `duplicate` (already known — you are done) or
`regression` (a closed bug came back, which is serious).

```json
{
  "title": "one line, what is wrong — not what you did",
  "class": "money|tenancy|offline|console|network|permissions|perf|ui",
  "severity": "critical|high|medium|low",
  "route": "/checkout",
  "charter": "001",
  "signature": "stable identity: the assertion that failed, no values in it",
  "observed": "what actually happened, with the numbers",
  "expected": "what should have happened, and why",
  "invariant": "CLAUDE.md §3 rule 3 — rounding at cart total only",
  "repro": ["step", "step", "step"],
  "evidence": { "console": [], "network": [], "screenshot": null }
}
```

`signature` is the dedupe key — keep values *out* of it. "cart total not a
multiple of 5000" is a good signature; "total was 137,250" is not, because
tomorrow it will be a different number and you will file the same bug twice.

`severity`: **critical** = money is wrong or a tenant boundary leaked.
**high** = a cashier cannot complete a sale. Everything else is medium or low.

## Re-testing a fix

When the charter is a re-test, the fix is served on **port 3001**, not 3000.
Reproduce the original `repro` steps exactly, then probe *around* the fix for
what it might have broken. Then:

```bash
node .testing-loop/cli.mjs move --id bug-0007 --to verified   # or reopened
```

`verified` hands it to the ratchet, which writes the Playwright spec that locks
it shut. `reopened` sends it back to the coder with your note.
