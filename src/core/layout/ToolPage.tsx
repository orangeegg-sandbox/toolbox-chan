import type { HTMLAttributes, ReactNode } from "react";
import type { ToolDefinition } from "../tools/contracts";

interface ToolPageProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  tool: ToolDefinition;
  toolbar?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  hint?: ReactNode;
}

/** Named slots keep the core layout consistent while each tool owns its subtree. */
export function ToolPage({
  tool,
  toolbar,
  description,
  footer,
  hint,
  children,
  ...props
}: ToolPageProps) {
  const Icon = tool.icon;
  return (
    <section {...props} aria-label={`${tool.name} workspace`}>
      <div className="page-heading">
        <div className="heading-icon">
          <Icon size={20} strokeWidth={1.75} />
        </div>
        <div>
          <div className="heading-title">
            <h1>{tool.name}</h1>
            {tool.badge && <span className="small-tag">{tool.badge}</span>}
          </div>
          {tool.subtitle && <p>{tool.subtitle}</p>}
        </div>
      </div>
      {toolbar}
      {description}
      <div className="tool-content">{children}</div>
      {footer}
      {hint}
    </section>
  );
}
