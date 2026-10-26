# Unresolved source navigation: EXP8

This is a documented pre-existing defect, not a repaired bibliography or a scientific
verification pass. The strict command `python3 scripts/audit_article_links.py` must
continue to fail until the source references have been substantively resolved.
CI's `--check-baseline` mode reports the two existing defects explicitly and rejects
new missing fragments, duplicate IDs, or an unreviewed change to this baseline.

`egg-coagulation-lab/index.html` cites `#src-14` and `#src-15` but defines only
`src-1` through `src-13`. The first EXP8 revision
`0733e84f6cbb0dbf083653b47eb352bd5f7d9a05` already had this defect. A history check
of all 22 EXP8-changing revisions through `b77f72f5b4f0eae27fef4ef6850b14043ce2d3c0`
found no definition of either missing source. Bibliography repair commit
`717ca2da410d36e4ead69be691b0c96204af2696` did not resolve them.

There is also a claim-to-source mismatch requiring review: existing references
12 and 13 are Skolverket/NGSS curriculum sources, while the corresponding body
citations concern thermal gradients and turbidity. Reassigning 14/15 to 12/13
would neither establish the original identities nor repair that support gap.

Next step: substantively review the affected claims, identify directly supporting
sources, and obtain the appropriate editorial approval for any prose/bibliography
changes. Do not invent entries or silently renumber citations. Remove the explicit
baseline only after those changes and the strict checker both pass.
