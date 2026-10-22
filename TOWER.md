# Control tower

## Routes
| Kind    | Means                                      | Agent  | Backup | Size |
|---------|--------------------------------------------|--------|--------|------|
| plan    | Break a goal into steps                    | claude | codex  | M    |
| complex | Hard code, design, debugging               | claude | codex  | L    |
| image   | Make or fix an image                       | codex  | -      | M    |
| subtask | A planned step with clear files and output | dsh    | codex  | S    |
| test    | Write or fix tests for known code          | dsh    | codex  | S    |
| default | Anything else                              | claude | codex  | M    |

## Headroom
An agent takes a task only if it has at least this much left.
For Claude and Codex this is the lowest "% left" across their limit windows.
For DSH it is the money left this month: the DSH budget minus spend.

| Size | Claude / Codex | DSH ($ left) |
|------|----------------|--------------|
| S    | 5%             | $0.20        |
| M    | 15%            | $0.50        |
| L    | 30%            | $1.00        |

If the agent does not have enough, use the Backup and say so.

## DSH
Budget: $10 per month
Model: deepseek-flash, deepseek-v4-pro for size L
Peak hours: Mon-Fri 01:00-04:00 and 06:00-10:00 UTC (all other hours are off-peak)

Prices in USD per 1M tokens, from DeepSeek's price page. DeepSeek also treats Chinese
public holidays as off-peak; tower does not know them and prices those days as peak.

| Model           | Time     | Cache hit | Cache miss | Output | Images |
|-----------------|----------|-----------|------------|--------|--------|
| deepseek-flash  | Off-peak | $0.003    | $0.15      | $0.60  | yes    |
| deepseek-flash  | Peak     | $0.006    | $0.30      | $1.20  | yes    |
| deepseek-v4-pro | Off-peak | $0.022    | $0.66      | $1.98  | no     |
| deepseek-v4-pro | Peak     | $0.044    | $1.32      | $3.96  | no     |

## Background runs
- A hand-off must name the files it may touch. Two running tasks never share a file.
- A background task cannot hand off again.
