# Corpus audit

Source: existing `content/papers` + `content/books` (no raw files were in `content/inbox/` when this ran).
Papers already matched `9709_<session><yy>_<qp|ms>_<comp>[var].pdf`. Books renamed to clean component names.

## Summary

| Set | Count |
|---|---|
| Papers on disk | 1558 |
| Papers OK | 1558 |
| Corrupt PDF header | 0 |
| Papers >25 MiB | 0 |
| Manifest orphans (disk missing) | 0 |
| Disk orphans (not in manifest) | 0 |
| Books kept | 7 |
| tooLarge (skipped at collect, >24 MiB) | 13 |

## Books

| filename | catalog | status |
|---|---|---|
| `P1-Hodder.pdf` | `{"f":"P1-Hodder.pdf","title":"P1 by Hodder","comp":"P1","mb":17.0}` | OK |
| `P3-Calculus.pdf` | `{"f":"P3-Calculus.pdf","title":"Calculus (P3)","comp":"P3","mb":9.8}` | OK |
| `M-Hodder.pdf` | `{"f":"M-Hodder.pdf","title":"M1 by Hodder","comp":"M","mb":7.9}` | OK |
| `M-Oxford.pdf` | `{"f":"M-Oxford.pdf","title":"M1 by Oxford","comp":"M","mb":18.8}` | OK |
| `M-Understanding-Mechanics.pdf` | `{"f":"M-Understanding-Mechanics.pdf","title":"Understanding Mechanics","comp":"M","mb":16.7}` | OK |
| `S-Hodder.pdf` | `{"f":"S-Hodder.pdf","title":"S1 and S2 by Hodder","comp":"S","mb":5.3}` | OK |
| `MS-Combined.pdf` | `{"f":"MS-Combined.pdf","title":"A Level Maths Statistics and Mechanics","comp":"MS","mb":1.8}` | OK |

## tooLarge — owner action (Worker asset limit 25 MiB)

| title | MB |
|---|---|
| AQA A2 Maths | 213 |
| Essential Pure Mathematics | 29.1 |
| M1 coursebook | 42.6 |
| P1 coursebook | 26 |
| P3 by Hodder Publisher | 27.8 |
| P3 by oxford | 62.7 |
| P3 coursebook | 44 |
| Pure Mathematics 1 Textbook | 45.2 |
| S1 book by oxford | 28.5 |
| S1 coursebook | 30.7 |
| S2 Coursebook | 48.2 |
| S2 by oxford | 28.4 |
| a-level-mathematics-cambridge-elevate-teachers-resource-access-card-teachers | 162.9 |

## Papers (sample)

| filename | y | s | t | c | v | status |
|---|---|---|---|---|---|---|
| `9709_m16_ms_12.pdf` | 2016 | m | ms | 1 | 2 | OK |
| `9709_m16_ms_22.pdf` | 2016 | m | ms | 2 | 2 | OK |
| `9709_m16_ms_32.pdf` | 2016 | m | ms | 3 | 2 | OK |
| `9709_m16_ms_42.pdf` | 2016 | m | ms | 4 | 2 | OK |
| `9709_m16_ms_52.pdf` | 2016 | m | ms | 5 | 2 | OK |
| `9709_m16_ms_62.pdf` | 2016 | m | ms | 6 | 2 | OK |
| `9709_m16_ms_72.pdf` | 2016 | m | ms | 7 | 2 | OK |
| `9709_m16_qp_12.pdf` | 2016 | m | qp | 1 | 2 | OK |
| `9709_m16_qp_22.pdf` | 2016 | m | qp | 2 | 2 | OK |
| `9709_m16_qp_32.pdf` | 2016 | m | qp | 3 | 2 | OK |
| `9709_m16_qp_42.pdf` | 2016 | m | qp | 4 | 2 | OK |
| `9709_m16_qp_52.pdf` | 2016 | m | qp | 5 | 2 | OK |
| `9709_m16_qp_62.pdf` | 2016 | m | qp | 6 | 2 | OK |
| `9709_m16_qp_72.pdf` | 2016 | m | qp | 7 | 2 | OK |
| `9709_m17_ms_12.pdf` | 2017 | m | ms | 1 | 2 | OK |
| `9709_m17_ms_22.pdf` | 2017 | m | ms | 2 | 2 | OK |
| `9709_m17_ms_32.pdf` | 2017 | m | ms | 3 | 2 | OK |
| `9709_m17_ms_42.pdf` | 2017 | m | ms | 4 | 2 | OK |
| `9709_m17_ms_52.pdf` | 2017 | m | ms | 5 | 2 | OK |
| `9709_m17_ms_62.pdf` | 2017 | m | ms | 6 | 2 | OK |
| `9709_w25_qp_55.pdf` | 2025 | w | qp | 5 | 5 | OK |
| `9709_w25_qp_61.pdf` | 2025 | w | qp | 6 | 1 | OK |
| `9709_w25_qp_62.pdf` | 2025 | w | qp | 6 | 2 | OK |
| `9709_w25_qp_63.pdf` | 2025 | w | qp | 6 | 3 | OK |
| `9709_w25_qp_65.pdf` | 2025 | w | qp | 6 | 5 | OK |

_Full list: 1558 papers in `content/papers.json`._
