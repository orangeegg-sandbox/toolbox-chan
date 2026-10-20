import type { HTMLAttributes, ReactNode } from "react";

interface ToolPanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: string;
  step?: number;
  actions?: ReactNode;
  status?: ReactNode;
}
export function ToolPanel({
  title,
  step,
  actions,
  status,
  className = "",
  children,
  ...props
}: ToolPanelProps) {
  return (
    <section className={`workspace-panel ${className}`} {...props}>
      <div className="panel-heading">
        <div>
          {step !== undefined && <span className="step-number">{step}</span>}
          <h2>{title}</h2>
          {status}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
