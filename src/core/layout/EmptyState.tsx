import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import toolboxChan from "../assets/toolbox-chan.png";

interface EmptyStateProps {
  title: string;
  children?: ReactNode;
  icon?: LucideIcon;
  /** Shows the faded full-body character instead of the icon. */
  mascot?: boolean;
  action?: ReactNode;
}

/** Shared empty screen. The character art appears here and on the idle home page only. */
export function EmptyState({ title, children, icon: Icon, mascot, action }: EmptyStateProps) {
  return (
    <div className="empty-view">
      {mascot ? (
        <img className="empty-mascot" src={toolboxChan} alt="" width="1024" height="1536" />
      ) : (
        Icon && <Icon size={32} strokeWidth={1.5} aria-hidden="true" />
      )}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
