/** One keyboard behavior for workspace and report navigation. Panels use the
 * generated IDs and aria-labelledby; inactive panels remain hidden. */
export function SessionTabs<T extends string>({ items, value, onChange, label, prefix }: {
  items: readonly { id: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  prefix: string;
}) {
  return <div className="sa-tabs" role="tablist" aria-label={label} onKeyDown={(event) => {
    const current = items.findIndex((item) => item.id === value);
    const next = event.key === "ArrowRight" ? (current + 1) % items.length
      : event.key === "ArrowLeft" ? (current + items.length - 1) % items.length
        : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    onChange(items[next].id);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }}>
    {items.map((item) => <button key={item.id} type="button" role="tab" id={`${prefix}-tab-${item.id}`} aria-controls={`${prefix}-panel-${item.id}`}
      aria-selected={value === item.id} tabIndex={value === item.id ? 0 : -1} onClick={() => onChange(item.id)}>
      {item.label}{item.count !== undefined && <span className="sa-tab-count">{item.count.toLocaleString()}</span>}
    </button>)}
  </div>;
}
