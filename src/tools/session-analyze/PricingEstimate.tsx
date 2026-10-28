import { useMemo } from "react";
import { desktop } from "./backend";
import { estimateSessionCost } from "./pricing";
import { useSessionAnalyze } from "./SessionAnalyzeProvider";
import type { GeneralChatAnalyze } from "./types";

export function PricingEstimate({ report }: { report: GeneralChatAnalyze }) {
  const state = useSessionAnalyze();
  const estimate = useMemo(() => state.pricing ? estimateSessionCost(report, state.pricing.catalog) : null, [report, state.pricing]);
  return <section aria-label="JSON model pricing">
    <h3>Model price files</h3>
    <p>Prices are selected for each recorded model call using its timestamp. Input, cache reads, cache writes, and output are priced separately. These are token-only API estimates; subscriptions, taxes, and per-request tool charges are excluded.</p>
    <div className="sa-toolbar">
      <button className="button secondary" disabled={!!state.busy || !desktop} onClick={() => void state.openPrices()}>Open pricing folder</button>
      <button className="button secondary" disabled={!!state.busy} onClick={() => void state.reloadPrices()}>Reload prices</button>
    </div>
    <p className="sa-path">{state.pricing?.folder || (desktop ? "The pricing folder is created when model prices first load." : "Browser preview uses bundled price files. Edit local prices in the desktop app.")}</p>
    {state.pricing && <p className="sa-muted">Loaded files: {state.pricing.files.join(", ") || "None"}. Edit a JSON file or copy model.example to a new .json file, then reload. Existing files are never replaced by app updates.</p>}
    {state.pricingError && <p className="error-banner" role="alert">Prices could not be loaded: {state.pricingError}</p>}
    {!!state.pricing?.errors.length && <div className="error-banner" role="alert"><p>Fix these price files, then reload. Automatic estimates are disabled.</p><ul className="sa-pricing-list" aria-label="Price file errors" tabIndex={0}>{state.pricing.errors.map((error, i) => <li key={i}>{error}</li>)}</ul></div>}
    {estimate && <>
      <p><strong>{estimate.amount === null ? `Partial token subtotal: $${estimate.subtotal.toFixed(6)} USD` : `JSON token estimate: $${estimate.amount.toFixed(6)} USD`}</strong> · {estimate.pricedSamples} / {estimate.totalSamples} usage records priced</p>
      {estimate.amount === null && <p className="sa-muted">A partial subtotal is not the session total and cannot be saved as one.</p>}
      {!!estimate.issues.length && <ul className="sa-pricing-list" aria-label="Pricing issues" tabIndex={0}>{estimate.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
      {!!estimate.appliedRules.length && <section className="sa-note"><h4>Applied price rules ({estimate.appliedRules.length})</h4><ul className="sa-pricing-list" aria-label="Applied price rules" tabIndex={0}>{estimate.appliedRules.map((rule, i) => <li key={i}>{rule}</li>)}</ul></section>}
      {!!estimate.sampleCosts.length && <section className="sa-note"><h4>Usage pricing breakdown ({estimate.sampleCosts.length})</h4>
        <p className="sa-muted">Rates are USD per million tokens, in order: uncached input / cache read / cache write / output. Period names refer to the windows or date overrides in the JSON file.</p>
        <div className="sa-table-scroll sa-pricing-breakdown" role="region" aria-label="Priced calls" tabIndex={0}><table aria-label="Usage pricing breakdown"><thead><tr><th>Usage / model</th><th>Price rule / period</th><th>Rates</th><th>USD</th></tr></thead><tbody>{estimate.sampleCosts.map((sample) => <tr key={sample.sampleId}>
          <td><code>{sample.sampleId}</code><br />{sample.model}</td><td>{sample.file}#{sample.ruleId}<br />{sample.rateLabel}</td><td>{[sample.prices.input, sample.prices.cachedInput, sample.prices.cacheWriteInput, sample.prices.output].map((price) => price ?? "Unknown").join(" / ")}</td><td>{sample.amount.toFixed(6)}</td>
        </tr>)}</tbody></table></div>
      </section>}
      <button className="button secondary" disabled={estimate.amount === null || report.cost.basis === "reported" || !!state.busy} onClick={() => { if (estimate.amount !== null) state.saveEstimate(estimate.amount, estimate.detail); }}>Use JSON estimate in report</button>
      {report.cost.basis === "reported" && <p className="sa-muted">The recorded cost is preserved. The JSON estimate is available for comparison.</p>}
    </>}
  </section>;
}
