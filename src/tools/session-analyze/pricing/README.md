# Session token pricing

This folder contains the bundled pricing seed and a template for the app's editable pricing folder. The app reads `.json` documents. `model.example` is deliberately excluded and contains invalid placeholder rates, so copying it without completing it cannot silently price a session at zero.

Prices are **API token estimates in USD**, not subscription bills or proof of cash charges. Search, fetch, images priced separately, tool requests, taxes, discounts, credits, and other non-token fees are excluded. An incomplete subtotal is never presented as the complete session estimate.

## Bundled DeepSeek prices

`deepseek.json` records the [official DeepSeek pricing page](https://api-docs.deepseek.com/quick_start/pricing/) checked on **2026-10-27**. It covers exact IDs `deepseek-flash` and `deepseek-v4-pro`, with only the two explicitly documented Flash aliases: `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp`.

The effective interval begins at `2026-10-27T00:00:00Z`, the observation date. This is **not** an assertion about when these prices originally took effect. Earlier sessions remain unknown until a verified historical rule is added. The file is a local snapshot; it does not refresh or assume future provider changes automatically.

| Model | Period | Uncached input / 1M | Cache read / 1M | Output / 1M |
| --- | --- | ---: | ---: | ---: |
| Flash | Off-peak | $0.15 | $0.003 | $0.60 |
| Flash | Peak | $0.30 | $0.006 | $1.20 |
| V4 Pro | Off-peak | $0.66 | $0.022 | $1.98 |
| V4 Pro | Peak | $1.32 | $0.044 | $3.96 |

Peak windows are Monday–Friday, **01:00–04:00 and 06:00–10:00 UTC**, excluding Chinese public holidays. A named calendar uses China local dates (`Asia/Shanghai`); weekday windows keep their own UTC zone. The [State Council's 2026 holiday notice](https://www.gov.cn/zhengce/content/202511/content_7047090.htm), checked on 2026-10-27, lists its final holiday period as October 1–7. The seed therefore records verified calendar coverage from October 27 through December 31, with no remaining holiday overrides. It refuses to price dates outside that calendar coverage, including otherwise off-peak hours. Add verified 2027 coverage before pricing those requests.

The published table does not specify a separate cache-write bucket; its price remains `null`. Requests with a known zero cache-write count can be priced. Positive or unknown cache-write counts need verified accounting rather than an assumed zero rate. DeepSeek also announces per-request Search/Fetch billing beginning **November 1, 2026 at 00:00 Beijing time**; this token estimator does not include those fees.

## Add or change a model

1. Copy `model.example` into the app's pricing folder and change its extension to `.json` after completing it.
2. Enter the exact model ID recorded in the usage samples. IDs are case-sensitive; aliases must be explicitly listed. There are no prefix matches, family guesses, or platform defaults.
3. Verify prices against the provider and record the source URL, checked date, and effective interval. Do not backdate a current price to historical sessions without evidence.
4. Reload pricing in the app. **Any invalid document disables all automatic pricing**, including other valid files. The displayed errors identify the file and field.

For a price change, end the older rule at the new rule's start, then add a new rule ID. Intervals are half-open: `effectiveFrom` is included and `effectiveUntil` is excluded. An explicit `null` end is open-ended. Both endpoints use full ISO UTC timestamps ending in `Z`. Overlapping intervals for any exact ID or alias are rejected, even if their prices happen to agree.

## JSON v1 fields

The document has only `schemaVersion: 1`, `currency: "USD"`, and `rules`. Unknown fields are errors, so misspelled prices cannot be silently ignored. A rule contains:

| Field | Meaning |
| --- | --- |
| `id` | Unique rule ID within its file; retained in calculation provenance. |
| `model` | Exact recorded model ID. |
| `aliases` | Optional list of explicit IDs with identical pricing. |
| `effectiveFrom`, `effectiveUntil` | UTC interval as described above. |
| `source` | `{ "url": "https://…", "checkedAt": "YYYY-MM-DD", "notes": "optional explanation" }`. |
| `prices` | Required `input`, `cachedInput`, and `output` numeric USD prices per million; `cacheWriteInput` is optional or `null` when unknown. |
| `schedule` | Optional weekday windows and date calendar, described below. |

Prices must be finite and nonnegative; a verified free price may be zero. `input` prices **uncached, non-cache-write input**. The usage sample's `inputTokens` includes all input, so the formula is:

```text
uncached = inputTokens - cachedInputTokens - cacheWriteInputTokens
USD = (uncached × input price + cached × cachedInput price
       + cacheWrite × cacheWriteInput price + output × output price) / 1,000,000
```

Reasoning tokens are already part of output and are not billed again. A missing cache-write price is acceptable only when its known count is zero. Missing counts, negative counts, unsafe integers, or cache buckets exceeding total input leave that sample unpriced.

A single `cacheWriteInput` rate assumes all recorded writes in that rule use the same billing rate. Providers with different cache TTLs, fast/batch modes, or other pricing dimensions require separately attributable samples and appropriate model/rule accounting. Do not use one assumed cache rate to mix them. No unverified OpenAI or Claude prices are bundled.

### Weekday windows and holiday overrides

`schedule` contains `timeZone`, `windows`, and optionally `calendar`. Use a supported IANA zone such as `UTC`, `Asia/Shanghai`, or `America/New_York`; daylight saving is resolved for each sample's actual instant. `windows` entries have:

```json
{
  "weekdays": [1, 2, 3, 4, 5],
  "start": "09:00",
  "end": "17:00",
  "prices": { "input": 2, "cachedInput": 0.2, "cacheWriteInput": null, "output": 8 }
}
```

These example numbers are illustrative, not provider prices. Weekdays are Monday `1` through Sunday `7`. Windows include the start and exclude the end. `24:00` is accepted only as an end. Split overnight windows across two days explicitly. Overlapping windows on a shared weekday are rejected. Outside a window, the rule's base `prices` apply.

An optional `calendar` contains `timeZone`, `coverageFrom`, exclusive `coverageUntil`, `source`, and `overrides`. An override has `{ "date": "YYYY-MM-DD", "prices": { ... } }` and replaces the entire local day's pricing, before weekday windows. Record every exception within the declared calendar coverage; an empty list asserts there are none. Duplicate dates and dates outside coverage are invalid. Calendar and schedule zones may differ. If a calendar is present, **every sample outside its coverage remains unknown**, conservatively including off-peak samples; without a calendar, a schedule explicitly declares no date-based exceptions.

## Completeness and audit information

Every sample needs a model, an ISO timestamp with `Z` or a numeric time-zone offset, and known input/output/cache-read/cache-write counts. A timestamp is required even for flat prices because historical intervals still apply. Duplicate sample IDs are excluded rather than charged twice.

The estimator exposes the priced sample count, partial subtotal, issues, and each sample's source file/rule, applied prices, window/date selection, source URL, checked date, and calendar source. It reports a complete amount only when the report explicitly has `usageSamplesComplete: true`, every sample is priced, and the sum of samples matches every known aggregate input/output/cache-read total. Unknown aggregate totals remain incomplete. Importers must mark incomplete or truncated logs accordingly; a partial log's internally consistent totals do not prove complete session usage.

Rates are selected using the recorded usage-event timestamp. A provider may select its billing rate at a different instant, such as request start or completion; the cited DeepSeek page does not specify that boundary convention. Results near a time or historical price boundary are estimates, not exact invoice reconciliation.

The parser accepts at most 32 files, 1 MiB per file, 8 MiB combined, and 2,000 rules overall. These limits bound local work; exceeding a limit disables pricing instead of silently skipping configuration. Files are data only: no scripts, remote fetches, or price expressions are executed.
