# Sample Label Test Pack

Use `sample-applications.csv` with the 12 synthetic images in this folder.

Expected / intended outcomes:

| File | Intended outcome | Why |
|---|---|---|
| 01-perfect.png | Pass | All application fields and warning match. |
| 02-wrong-abv.png | Fail | Label shows 40% ABV / 80 Proof while application says 45% ABV. |
| 03-wrong-volume.png | Fail | Label shows 700 mL while application says 750 mL. |
| 04-brand-case-only.png | Needs Review | Label uses title case while application uses uppercase. |
| 05-warning-title-case.png | Fail | Heading is `Government Warning:` instead of required uppercase `GOVERNMENT WARNING:`. |
| 06-warning-word-changed.png | Fail | Warning wording is altered by adding the word `serious`. |
| 07-warning-missing.png | Fail | Government warning is absent. |
| 08-warning-not-bold.png | Fail | `GOVERNMENT WARNING:` heading is intentionally regular weight, not bold. |
| 09-glare.png | Needs Review | Strong glare obscures important label content; app should request a clearer image rather than guess. |
| 10-angled.png | Pass or Needs Review | Angled but still intended to be readable; exact image-quality result may vary by vision extraction. |
| 11-imported-pass.png | Pass | Label says Product of Canada and application country is Canada. |
| 12-country-mismatch.png | Fail | Label says Product of Mexico while application country is Canada. |

Notes:
- These are synthetic/fake labels for prototype testing only.
- Vision-model extraction is probabilistic, so image-quality cases can vary slightly across runs.
- Deterministic checks (warning text, ABV, volume, normalized text comparisons) should remain consistent once extraction succeeds.
