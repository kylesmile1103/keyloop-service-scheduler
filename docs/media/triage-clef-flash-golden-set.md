# Clef-flash live AI golden set

Model: @cf/cloudflare/clef-flash. Images: none (text regression set).

Thresholds: service 0.50, date 0.60, uncovered 0.60; candidate absolute 0.10, relative 0.50.
Hinted fixtures name the main task or what is excluded ("Main task", "Book X; also", "no ... needed"); natural ones do not. The uncovered answer is scored against the service Clef chose: joint accuracy needs an accepted (service, uncovered) pair, and accuracy given the service counts only fixtures whose chosen service is accepted.

Service choice accuracy: all 42/49; hinted 9/13; natural 33/36.
Joint service and uncovered accuracy: all 37/49; hinted 7/13; natural 30/36.
Uncovered accuracy given an accepted service: all 37/42; hinted 7/9; natural 30/33.
Date choice accuracy (including NO_SPECIFIC_DATE): 47/49.
Concrete dates exposed correctly: 3/3; false dates exposed: 0.
Uncovered given an accepted service: positive 7/10; NONE 30/32.
Exposed notices given an accepted service: correct 3/10; false 0; missed 7; wrong category 0.
Product owner's case (fixture 46): service ACCIDENT-DAMAGE-ASSESSMENT (0.54), uncovered ACCIDENT_OR_BODY_DAMAGE (0.09), exposed NONE outside none; accepted pair: no; correct notice shown: no.
Required abstention/confirmation: 10/10; all abstentions/confirmations: 25/49.
Latency p50: 589.7 ms; p95: 959.3 ms. Input tokens: 105253; usage missing in 0/49 requests.
Third question adds 1704 UTF-8 request bytes, approximately 426 input tokens at 4 bytes/token (offline planning estimate, not measured Clef tokenization). One request per fixture; upstream reports total usage, not per-question usage.
Original 25 fixtures: 53621 input tokens versus the historical two-question total 39696. This comparison also includes catalogue/rubric/date changes and is not an isolated third-question measurement.

## Uncovered confusion given an accepted service (raw validated choice)

Rows are expected for the chosen service, columns are actual. NONE includes suppressed notices in the exposed matrix.

| Expected / Actual | NONE | ACCIDENT_OR_BODY_DAMAGE | LIGHTS_OR_ELECTRICAL_ACCESSORY | AIR_CONDITIONING | TYRES_OR_WHEELS | GLASS | OTHER |
|---|---|---|---|---|---|---|---|
| NONE | 30 | 0 | 1 | 0 | 0 | 1 | 0 |
| ACCIDENT_OR_BODY_DAMAGE | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| LIGHTS_OR_ELECTRICAL_ACCESSORY | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| AIR_CONDITIONING | 0 | 1 | 0 | 3 | 0 | 0 | 0 |
| TYRES_OR_WHEELS | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| GLASS | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| OTHER | 1 | 0 | 0 | 0 | 0 | 0 | 1 |

## Uncovered confusion given an accepted service (exposed at the configured threshold)

Rows are expected for the chosen service, columns are actual. NONE includes suppressed notices in the exposed matrix.

| Expected / Actual | NONE | ACCIDENT_OR_BODY_DAMAGE | LIGHTS_OR_ELECTRICAL_ACCESSORY | AIR_CONDITIONING | TYRES_OR_WHEELS | GLASS | OTHER |
|---|---|---|---|---|---|---|---|
| NONE | 32 | 0 | 0 | 0 | 0 | 0 | 0 |
| ACCIDENT_OR_BODY_DAMAGE | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| LIGHTS_OR_ELECTRICAL_ACCESSORY | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| AIR_CONDITIONING | 4 | 0 | 0 | 0 | 0 | 0 | 0 |
| TYRES_OR_WHEELS | 0 | 0 | 0 | 0 | 1 | 0 | 0 |
| GLASS | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| OTHER | 2 | 0 | 0 | 0 | 0 | 0 | 0 |

## Uncovered threshold calibration (given an accepted service)

| Threshold | Correct notices | False notices | Missed notices | Wrong category |
|---|---|---|---|---|
| 0.00 | 7 | 2 | 2 | 1 |
| 0.30 | 6 | 1 | 4 | 0 |
| 0.40 | 6 | 1 | 4 | 0 |
| 0.50 | 5 | 0 | 5 | 0 |
| 0.60 | 3 | 0 | 7 | 0 |
| 0.70 | 1 | 0 | 9 | 0 |
| 0.80 | 0 | 0 | 10 | 0 |
| 0.90 | 0 | 0 | 10 | 0 |
| 1.00 | 0 | 0 | 10 | 0 |

## Candidate retention by relative floor

Recomputed with the production mapper from each answer's validated service probabilities (absolute floor 0.10, at most three). Retained counts fixtures whose accepted bookable service survives as a candidate.

| Relative floor | Accepted service retained | Mean candidates | Single-candidate answers |
|---|---|---|---|
| 0.00 | 40/40 | 1.35 | 34 |
| 0.30 | 39/40 | 1.29 | 36 |
| 0.50 | 39/40 | 1.18 | 39 |
| 0.70 | 38/40 | 1.06 | 42 |

## Per-fixture results

| Fixture | Subset | Accepted (service+uncovered) | Service choice | Service confidence | Recommendation | Candidates | Accepted rank | Date expected | Date choice | Date confidence | Uncovered choice | Uncovered confidence | Exposed category | Outside service | Input tokens | Latency ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | natural | BRAKES-PADS-DISCS+NONE | BRAKES-PADS-DISCS | 0.509 | suggest | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.205 | NONE | 0.538 | NONE | - | 2144 | 1044.3 |
| 2 | natural | BRAKES-PADS-DISCS+NONE | BRAKES-PADS-DISCS | 0.629 | suggest | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.278 | NONE | 0.539 | NONE | - | 2144 | 614.2 |
| 3 | natural | BRAKES-PADS-DISCS+NONE | BRAKES-PADS-DISCS | 0.392 | confirm | 1 | 1 | 2026-10-13 | 2026-10-13 | 0.672 | NONE | 0.515 | NONE | - | 2144 | 596.3 |
| 4 | natural | BRAKES-PADS-DISCS+NONE | BRAKES-PADS-DISCS | 0.580 | suggest | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.236 | NONE | 0.573 | NONE | - | 2143 | 611.2 |
| 5 | natural | INTERIM-SERVICE+NONE | INTERIM-SERVICE | 0.690 | suggest | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.290 | NONE | 0.641 | NONE | - | 2145 | 570.2 |
| 6 | natural | INTERIM-SERVICE+NONE | INTERIM-SERVICE | 0.589 | suggest | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.202 | NONE | 0.632 | NONE | - | 2143 | 583.7 |
| 7 | natural | FULL-SERVICE+NONE | FULL-SERVICE | 0.491 | confirm | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.265 | NONE | 0.563 | NONE | - | 2142 | 598.0 |
| 8 | natural | FULL-SERVICE+NONE | FULL-SERVICE | 0.506 | suggest | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.319 | NONE | 0.507 | NONE | - | 2143 | 574.3 |
| 9 | natural | MOT-TEST+NONE | MOT-TEST | 0.716 | suggest | 1 | 1 | 2026-10-13 | 2026-10-13 | 0.727 | NONE | 0.605 | NONE | - | 2144 | 569.2 |
| 10 | natural | MOT-TEST+NONE | MOT-TEST | 0.835 | suggest | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.307 | NONE | 0.471 | NONE | - | 2145 | 552.2 |
| 11 | natural | EV-BATTERY-CHECK+NONE | EV-BATTERY-CHECK | 0.474 | confirm | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.315 | NONE | 0.436 | NONE | - | 2147 | 568.0 |
| 12 | natural | EV-BATTERY-CHECK+NONE | EV-BATTERY-CHECK | 0.745 | suggest | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.338 | NONE | 0.579 | NONE | - | 2142 | 568.3 |
| 13 | natural | EV-CHARGING-FAULT+NONE | EV-CHARGING-FAULT | 0.783 | suggest | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.176 | NONE | 0.542 | NONE | - | 2143 | 559.3 |
| 14 | natural | EV-CHARGING-FAULT+NONE | EV-CHARGING-FAULT | 0.758 | suggest | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.234 | NONE | 0.413 | NONE | - | 2146 | 608.2 |
| 15 | natural | WHEEL-ALIGNMENT+NONE | WHEEL-ALIGNMENT | 0.678 | suggest | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.261 | NONE | 0.375 | NONE | - | 2146 | 591.6 |
| 16 | natural | WHEEL-ALIGNMENT+NONE | WHEEL-ALIGNMENT | 0.698 | suggest | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.271 | NONE | 0.305 | NONE | - | 2145 | 590.6 |
| 17 | natural | HEAVY-VAN-SERVICE+NONE | HEAVY-VAN-SERVICE | 0.743 | suggest | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.157 | NONE | 0.411 | NONE | - | 2143 | 591.1 |
| 18 | natural | AIRCON-REGAS+NONE | AIRCON-REGAS | 0.724 | suggest | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.414 | NONE | 0.552 | NONE | - | 2146 | 586.0 |
| 19 | natural | DIAG-FAULT-FINDING+NONE | DIAG-FAULT-FINDING | 0.460 | confirm | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.343 | NONE | 0.450 | NONE | - | 2144 | 590.2 |
| 20 | natural | DIAG-FAULT-FINDING+NONE | DIAG-FAULT-FINDING | 0.448 | confirm | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.409 | NONE | 0.468 | NONE | - | 2143 | 583.9 |
| 21 | natural | DIAG-FAULT-FINDING+NONE | DIAG-FAULT-FINDING | 0.107 | confirm | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.221 | NONE | 0.307 | NONE | - | 2147 | 554.2 |
| 22 | natural | NONE_OF_THESE+NONE | NONE_OF_THESE | 0.643 | no-match | 0 | n/a | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.740 | NONE | 0.598 | NONE | - | 2146 | 938.0 |
| 23 | natural | NONE_OF_THESE+NONE | NONE_OF_THESE | 0.645 | no-match | 0 | n/a | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.608 | LIGHTS_OR_ELECTRICAL_ACCESSORY | 0.416 | NONE | - | 2144 | 582.7 |
| 24 | natural | BRAKES-PADS-DISCS+NONE | BRAKES-PADS-DISCS | 0.520 | suggest | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.307 | NONE | 0.557 | NONE | - | 2149 | 758.4 |
| 25 | natural | BRAKES-PADS-DISCS+NONE | BRAKES-PADS-DISCS | 0.560 | suggest | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.416 | NONE | 0.675 | NONE | - | 2153 | 959.3 |
| 26 | natural | ACCIDENT-DAMAGE-ASSESSMENT+NONE | ACCIDENT-DAMAGE-ASSESSMENT | 0.745 | suggest | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.185 | GLASS | 0.134 | NONE | - | 2148 | 625.8 |
| 27 | natural | ACCIDENT-DAMAGE-ASSESSMENT+NONE | ACCIDENT-DAMAGE-ASSESSMENT | 0.685 | suggest | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.372 | NONE | 0.221 | NONE | - | 2149 | 559.8 |
| 28 | natural | ACCIDENT-DAMAGE-ASSESSMENT+NONE | ACCIDENT-DAMAGE-ASSESSMENT | 0.608 | suggest | 1 | 1 | 2026-10-13 | 2026-10-13 | 0.763 | NONE | 0.125 | NONE | - | 2151 | 590.5 |
| 29 | hinted | NONE_OF_THESE+LIGHTS_OR_ELECTRICAL_ACCESSORY | NONE_OF_THESE | 0.135 | no-match | 2 | n/a | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.371 | NONE | 0.282 | NONE | - | 2152 | 578.5 |
| 30 | hinted | NONE_OF_THESE+GLASS | ACCIDENT-DAMAGE-ASSESSMENT | 0.265 | confirm | 1 | n/a | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.352 | NONE | 0.215 | NONE | - | 2148 | 594.8 |
| 31 | natural | NONE_OF_THESE+TYRES_OR_WHEELS | ACCIDENT-DAMAGE-ASSESSMENT | 0.101 | confirm | 2 | n/a | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.324 | NONE | 0.253 | NONE | - | 2143 | 590.5 |
| 32 | hinted | NONE_OF_THESE+ACCIDENT_OR_BODY_DAMAGE | ACCIDENT-DAMAGE-ASSESSMENT | 0.272 | confirm | 1 | n/a | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.427 | ACCIDENT_OR_BODY_DAMAGE | 0.302 | NONE | - | 2149 | 559.4 |
| 33 | hinted | NONE_OF_THESE+OTHER | NONE_OF_THESE | 0.111 | no-match | 3 | n/a | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.426 | NONE | 0.612 | NONE | - | 2147 | 556.5 |
| 34 | hinted | DIAG-FAULT-FINDING+NONE | DIAG-FAULT-FINDING | 0.285 | confirm | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.360 | NONE | 0.365 | NONE | - | 2147 | 982.0 |
| 35 | natural | DIAG-FAULT-FINDING+NONE | DIAG-FAULT-FINDING | 0.315 | confirm | 1 | 1 | NO_SPECIFIC_DATE | 2026-10-12 | 0.200 | NONE | 0.452 | NONE | - | 2151 | 572.3 |
| 36 | hinted | ACCIDENT-DAMAGE-ASSESSMENT+AIR_CONDITIONING | ACCIDENT-DAMAGE-ASSESSMENT | 0.590 | suggest | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.292 | AIR_CONDITIONING | 0.271 | NONE | - | 2162 | 600.6 |
| 37 | hinted | DIAG-FAULT-FINDING+ACCIDENT_OR_BODY_DAMAGE | ACCIDENT-DAMAGE-ASSESSMENT | 0.282 | confirm | 2 | 2 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.258 | ACCIDENT_OR_BODY_DAMAGE | 0.468 | NONE | - | 2157 | 593.1 |
| 38 | hinted | BRAKES-PADS-DISCS+AIR_CONDITIONING | BRAKES-PADS-DISCS | 0.176 | confirm | 2 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.374 | AIR_CONDITIONING | 0.547 | NONE | - | 2153 | 573.9 |
| 39 | hinted | INTERIM-SERVICE+LIGHTS_OR_ELECTRICAL_ACCESSORY | INTERIM-SERVICE | 0.152 | confirm | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.392 | LIGHTS_OR_ELECTRICAL_ACCESSORY | 0.755 | LIGHTS_OR_ELECTRICAL_ACCESSORY | INTERIM-SERVICE | 2149 | 558.2 |
| 40 | hinted | MOT-TEST+TYRES_OR_WHEELS | MOT-TEST | 0.167 | confirm | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.211 | TYRES_OR_WHEELS | 0.617 | TYRES_OR_WHEELS | MOT-TEST | 2151 | 600.2 |
| 41 | hinted | AIRCON-REGAS+GLASS | AIRCON-REGAS | 0.181 | confirm | 2 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.354 | GLASS | 0.679 | GLASS | AIRCON-REGAS | 2153 | 561.9 |
| 42 | hinted | WHEEL-ALIGNMENT+OTHER | WHEEL-ALIGNMENT | 0.262 | confirm | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.485 | OTHER | 0.538 | NONE | - | 2151 | 575.3 |
| 43 | hinted | BRAKES-PADS-DISCS+ACCIDENT_OR_BODY_DAMAGE | ACCIDENT-DAMAGE-ASSESSMENT | 0.409 | confirm | 1 | - | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.250 | ACCIDENT_OR_BODY_DAMAGE | 0.840 | ACCIDENT_OR_BODY_DAMAGE | ACCIDENT-DAMAGE-ASSESSMENT | 2152 | 589.7 |
| 44 | natural | INTERIM-SERVICE+NONE | INTERIM-SERVICE | 0.539 | suggest | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.290 | NONE | 0.458 | NONE | - | 2155 | 607.1 |
| 45 | natural | ACCIDENT-DAMAGE-ASSESSMENT+NONE | ACCIDENT-DAMAGE-ASSESSMENT | 0.727 | suggest | 1 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.329 | NONE | 0.349 | NONE | - | 2153 | 579.0 |
| 46 | natural | DIAG-FAULT-FINDING+ACCIDENT_OR_BODY_DAMAGE / ACCIDENT-DAMAGE-ASSESSMENT+AIR_CONDITIONING | ACCIDENT-DAMAGE-ASSESSMENT | 0.544 | suggest | 1 | 1 | NO_SPECIFIC_DATE | 2026-10-12 | 0.153 | ACCIDENT_OR_BODY_DAMAGE | 0.092 | NONE | - | 2160 | 560.6 |
| 47 | natural | BRAKES-PADS-DISCS+AIR_CONDITIONING / AIRCON-REGAS+OTHER | BRAKES-PADS-DISCS | 0.103 | confirm | 3 | 1 | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.350 | AIR_CONDITIONING | 0.402 | NONE | - | 2150 | 620.6 |
| 48 | natural | NONE_OF_THESE+GLASS | ACCIDENT-DAMAGE-ASSESSMENT | 0.485 | confirm | 1 | n/a | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.494 | GLASS | 0.620 | GLASS | ACCIDENT-DAMAGE-ASSESSMENT | 2151 | 573.6 |
| 49 | natural | NONE_OF_THESE+LIGHTS_OR_ELECTRICAL_ACCESSORY | ACCIDENT-DAMAGE-ASSESSMENT | 0.090 | confirm | 3 | n/a | NO_SPECIFIC_DATE | NO_SPECIFIC_DATE | 0.536 | LIGHTS_OR_ELECTRICAL_ACCESSORY | 0.327 | NONE | - | 2150 | 941.8 |
