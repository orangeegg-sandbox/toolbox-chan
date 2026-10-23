import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

interface ToggleRowProps {
  id: string;
  label: string;
  description: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** One on/off setting: its name and what it does on the left, the switch on the right. */
export function ToggleRow({ id, label, description, checked, onChange, disabled }: ToggleRowProps) {
  return (
    <div className="setting-row">
      <div>
        <label htmlFor={id}>{label}</label>
        <p>{description}</p>
      </div>
      <input
        id={id}
        className="toggle"
        role="switch"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </div>
  );
}

interface SelectRowProps<T extends string | number> {
  id: string;
  label: string;
  description: ReactNode;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}

export function SelectRow<T extends string | number>({ id, label, description, value, options, onChange, disabled }: SelectRowProps<T>) {
  return (
    <div className="setting-row">
      <div>
        <label htmlFor={id}>{label}</label>
        <p>{description}</p>
      </div>
      <div className="select-wrap">
        <select
          id={id}
          value={String(value)}
          disabled={disabled}
          onChange={(event) => onChange(options.find((option) => String(option.value) === event.target.value)!.value)}
        >
          {options.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
        </select>
        <ChevronDown size={14} />
      </div>
    </div>
  );
}
