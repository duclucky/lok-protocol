# Sepolia HCU Benchmark

Measured 2026-08-12T16:04:21.755Z on Ethereum Sepolia (chain 11155111) with probe
`0xFf607974D31445fd82D6D052926FEAc700AB46ae`.

**GATE 3: PASS.**

- No measured PASS A/B divergence exceeds 50%.
- No numeric demo-latency target is defined in the architecture; transaction projections are reported without inventing
  an SLA.

## Versions

| Component          | Version  |
| ------------------ | -------- |
| fhevmSolidity      | `0.11.1` |
| fhevmHardhatPlugin | `0.4.2`  |
| relayerSdk         | `0.4.1`  |
| hardhat            | `2.28.6` |

## HCU Results

The measured per-iteration value is the incremental global HCU slope between the one-iteration transaction and the
largest successful transaction. PASS A includes its final anonymity-mask/public-decryption overhead at both points.

| Path                  | Revised estimate | Measured / iteration | Difference | Max success | 60% cap | Boundary transaction                                                 |
| --------------------- | ---------------: | -------------------: | ---------: | ----------: | ------: | -------------------------------------------------------------------- |
| \_syncUser checkpoint |        2,430,000 |            2,430,032 |      +0.0% |           8 |       4 | `0x07421d1501d2065616150e617651278976f0ba3d53f07972d35974f523ac61a1` |
| PASS A participant    |        3,556,000 |            3,001,192 |     -15.6% |           6 |       3 | `0x1c6c0ceb9779c484691b7c362c96e2dfc2c1a529c74e482359f0d7575262bff1` |
| PASS B participant    |        3,870,000 |            4,025,320 |      +4.0% |           4 |       2 | `0x4395fc2844dee2c92ed94d0ec5d0a5f11406ad677db0ba52d59cdbfa421951e3` |
| strict randomness     |        1,211,000 |            1,211,000 |      +0.0% |          16 |       9 | `0x7e94d9bcfca65a31e5adbd56400d8b984fc27e397bdba2996d84d5ec7bb79eff` |
| Fortune update        |        [MEASURE] |              294,128 |        n/a |          67 |      40 | `0xbbc8983711ad8bb272e7a5cf44e8ebc4f56f04c81b16af74964ce6394ec0b894` |
| solvency boolean      |          473,000 |              476,000 |      +0.6% |          42 |      25 | `0x5a045dcbf43a8294df501c50a4d4de69ee3fb9040727d9dfc5718fefdbc32e42` |

Configured pre-sync remains the reviewed production constant 4. The measured safe ceilings for PASS A and PASS B are 3
and 2; constants are frozen only when GATE 3 passes.

## Draw Projections

Fixed open, total submission, randomness/reveal, and settlement transactions are excluded.

| Participants | preSync | PASS A | PASS B | Variable total |
| -----------: | ------: | -----: | -----: | -------------: |
|           10 |       3 |      4 |      5 |             12 |
|          100 |      25 |     34 |     50 |            109 |
|         1000 |     250 |    334 |    500 |           1084 |

## Decryption Latency

| Flow                     | Samples |     p50 |     p95 |
| ------------------------ | ------: | ------: | ------: |
| Public aggregate boolean |      10 | 2665 ms | 3609 ms |
| User Fortune handle      |      10 | 2744 ms | 3148 ms |

Raw observations, gas, HCU depth, and every transaction hash are in `artifacts/hcu-benchmark.json`. The deployer address
was `0x8e7939E23a012143e5182d7173DAD42B2006c2b8`; no secret material is stored in either artifact.
