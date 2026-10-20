import type { ReactNode } from "react";

export function SplitPane({
  primary,
  secondary,
}: {
  primary: ReactNode;
  secondary: ReactNode;
}) {
  return (
    <div className="workspace-grid">
      {primary}
      {secondary}
    </div>
  );
}
