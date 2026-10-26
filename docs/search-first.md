# Search-first candidate — unpublished

This separate development branch starts at public `b77f72f5b4f0eae27fef4ef6850b14043ce2d3c0`.
Its first local commit applies the independently reviewed UI-v3 prerequisite;
the second is the separable red compass favicon. The original UI-v3 patch/archive
are unchanged. No EXP8 prose/citation proposal, missing private essays, comments,
permissions or public deployment are included in this feature.

## Interface and preservation

The actual MärkR landing page and its baseline source were inspected read-only.
The new shell borrows the quiet centered search/wordmark arrangement, with
Explorations red, not MärkR's brass, bookmark data or animated network.
The existing 33 card DOM nodes, IDs, links, read-state integration and network
page remain. `Alla essäer` exposes that overview in the same page. Without the
enhancement, the HTML still exposes all essay links. If the new index fails,
search explicitly falls back to essay titles; it does not pretend full text worked.

`?q=` encodes search state; `#alla-essaer` identifies the overview. Typing replaces
the current history entry, view buttons push an entry, and popstate restores it.
Escape/clear cancel pending result display without modifying comments or storage.
Typing is debounced 120 ms, index loading is shared/cached, and a generation plus
exact-query check prevents a late response from replacing a newer view/query.
Result links remain normal same-tab anchors; Tab and Enter retain browser behavior.
`/` focuses search outside editable controls. Result counts use a polite atomic
live region; results never take focus while the user types.

## Exact lexical ranking, not semantic/AI search

Text uses NFKC and Swedish lowercasing, Unicode letters/marks/numbers, preserving
the distinction between a/ä/å and o/ö. Common and short words are not discarded.
Every query clause must match somewhere in the essay's indexed fields. Unquoted
words match exact words or word prefixes of at least two characters. Repeated
unquoted terms are deduplicated. Closed straight or smart double quotes require
adjacent whole words in a single field; an unfinished quote is treated as words.
Queries are capped at 240 characters.

Fields have weights: essay title **6**, headings **3**, body **1**, bibliographic
title line **1.6**. Exact occurrences count 1; prefix occurrences contribute 0.65
to score, while the displayed occurrence count uses the actual integer matches.
For each field kind the score is
`weight * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * fieldLength / meanFieldLength))`.
Thus frequency helps with diminishing returns and length is normalized. Exact
phrase occurrences add 2 each, capped at four. This is a transparent weighted
term-frequency model, not a measured optimum or semantic similarity system.
Ties use ascending stable slug. Snippets are selected by matching field/phrase
strength and identify heading, body or bibliographic-title-line evidence.
Quoted snippets center the complete exact phrase and do not highlight isolated prefix words. Highlighting creates text/mark nodes, never interpolated untrusted HTML.

## Corpus and precise title coverage

`scripts/build_landing_search.py` reads only local public HTML. It includes dynamic
AI essay fragments, narrative callout divs, definitions, captions and code diagrams,
including standfirst/subtitle prose outside both main and article. Navigation, table-of-contents duplicates and reading metadata are excluded. Each inline run is counted
once. Source sections, their notes, verification badges and source quotations are
excluded from essay-body fields. Bibliographic fields use the authored title/link
line, which may retain author/year/journal context. They do not claim a new canonical
title reconstruction. Generic PDF/DOI/URL labels are not mistaken for titles.
The browser and offline index builder fetch no external source metadata or fulltext. A later bounded metadata-only identity lookup is described below; its reviewed title values are stored locally.

The frozen v3 audit had **33 essays, 585 authored bibliographic title lines and25
URL-only rows** (four in dark-matter-dark-energy and21 in muskoxen-norway).
Revision4 adds **six identity-reviewed metadata title rows** (four distinct titles),
for **591 searchable reference-title rows**. **19 remain excluded**:15 generic
homepage/portal citations, two confirmed wrong identities, one ambiguous metadata
identity and one unavailable exact URL. This is NOT complete reference-title
coverage or scientific-source verification. Exact-URL lookup through available
repository history had recovered no authored titles. No title is inferred from
a URL slug or nearby claim. The generated `search-index-audit.json` records
remaining gaps and metadata provenance. The original article bibliography is unchanged. Five unlinked book/thesis rows are included; authored titles outside publisher links are retained. Reference lists without individual row anchors jump to their existing Sources heading.

## Reproduce and limitations

Production remains static and dependency-free. Test-only jsdom 26.1.0 is pinned by
package-lock.json. Dependencies were installed from the existing cache using
`npm ci --offline --ignore-scripts --cache /tmp/markr-npm-cache --no-audit --no-fund`;
no registry retrieval was performed. A different environment needs that dependency
cache or an authorized ordinary `npm ci --ignore-scripts`.

Run the existing AGENTS commands, then `python3 scripts/build_landing_search.py`,
`python3 scripts/inject-favicon.py`, and `node --test`. Generation is deterministic.
SVG is the authoritative favicon; 16/32 PNGs were rasterized by installed Inkscape
and compiled into ICO. No browser was used for asset compilation.

jsdom/source tests are **not** actual rendered-browser, mobile, screen-reader or
visual acceptance. Public MärkR was visually inspected in the supported cloud
browser, but the new private candidate has no approved rendered preview yet.
Previously blocked shell-Chromium/file routes were not retried or bypassed.
Strict EXP8 fragment/source debt remains independently open. No publication is
authorized or asserted by these tests or the local commits.

## Revision 2 review corrections

The frozen v1 archive and both independent FAIL reports remain in the QA evidence.
Revision 2 adds missing standfirst coverage and CI dependency installation, restores
seven locally available bibliography title lines correctly (five newly indexed),
fixes quoted snippets, repeated-token ranking and history retry state, and corrects
forced-dark contrast and Swedish language metadata. It also adds a skip link and
contextual jump labels. Source quotes/annotation paragraphs are never citation-title
fallback text. Navigation, related-essay summaries and subject badges are excluded
from prose frequency counts. These are local tested changes pending exact-revision
independent re-review; they are not a publication or rendered visual acceptance.

## Revision 3 language-of-parts correction

Independent v2 review found that copied English essay text inherited the Swedish
results-region language. The index now records the original article HTML language
(all33 currently declare en), and copied title/subject/heading/excerpt/body text
uses it. Swedish result labels, counts and jump descriptions remain Swedish.
Bibliographic title snippets explicitly use unknown language (`lang=""`), rather
than pretending every referenced title is English; no external metadata is fetched.
V1 and v2 artifacts and independent review history remain frozen.

The same v3 correction joins AI essay fragments with an empty separator, exactly
like the original page runtime, preserving words split across file boundaries.
This changes only the generated search corpus, not the original essay fragments.
The v2 low-severity math-symbol mismatch is also corrected: NFKC-compatible
highlighting tokenizes the same way as retrieval while mapping matches back to
the original glyphs. A full-corpus token-stream regression covers the current data.

## Revision 4 — bounded title-metadata enrichment

A separate branch preserves frozen v3. `docs/reference-title-enrichment.json`
accounts for exactly the25 prior gaps. An independent identity-only review approved
six rows: DESI arXiv2404.03002, two exact DOIs (the PLOS DOI occurs in three rows),
and the exact NPS Muskox page. Crossref selected fields, arXiv Atom/catalog
metadata and NPS HTML-head metadata supplied titles; no external paper/page
fulltext is used. The HTML-head collector uses bounded GET chunks and discards
body-adjacent bytes, so evidence establishes no retained article body, not zero
body-adjacent bytes buffered. Retrieval UTC dates, URLs and receipt hashes are
retained in the map. Offline generation makes no external requests.

Only `verified-title` records may contribute titles, and every original slug,
anchor and URL must still match an unresolved row. Stale maps fail the build.
Other statuses never contribute metadata text to search. Result snippets identify
these as bibliographic metadata, not authored title lines or verified support.

Two exact identities are quarantined: the dark-matter src-11 arXiv URL identifies
a hate-speech detection paper, not the cited LUX-ZEPLIN result; src-16 OpenLibrary
redirects to *The Treason of Isengard*, not the locally cited Kuhn discussion.
E-Periodica's requestedPID119/head og:PID447 inconsistency is ambiguous, not a
proven wrong work. The exact NSIDC URL returned404. Generic homepage titles are
not treated as titles of unidentified cited works. None of these findings rewrites
a citation, article, existing Verified badge or the independent EXP8 source debt.

Independent identity proposal SHA256:
`bd3adbb200d14c96681b539b327ec356bed99fd871e924e0326cc43694b58e3f`.
Identity-review report SHA256:
`4124ae313eb61979044604d1a750823ad9aafd1f20f36a8294393a531abe37e1`.
This is technical title-index provenance, not a full scientific fact-check.

## Revision 5 — portable arXiv version provenance

V4's independent provenance review found that the derived map omitted the
versioned arXiv identifiers while claiming the version was recorded. V5 preserves
2404.03002v3 in the approved map and indexed provenance, and2410.08053v1 in the
quarantined map record only. Original citation URLs and title text are unchanged.
Review/evidence hash fields and exact arXiv version format are now required by
the generator. Hash-format validation is not cryptographic proof of scientific
support; acceptance still relies on the independently reviewed exact artifact.
No additional metadata request was needed. V4 evidence remains frozen.
