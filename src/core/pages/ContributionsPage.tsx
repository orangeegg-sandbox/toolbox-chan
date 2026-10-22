import { useToolbox } from "../ToolboxContext";
import { EmptyState } from "../layout";

export function ContributionsPage() {
  const { tools } = useToolbox();
  const contributors = tools.filter((tool) => tool.Activity);
  return (
    <>
      <h1>Recent activity</h1>
      <p className="page-intro">
        Pick up where you left off in your tools.
      </p>
      {contributors.map((tool) => {
        const Surface = tool.Activity!;
        return (
          <section
            className="tool-contribution"
            key={tool.id}
            aria-label={`${tool.name} activity`}
          >
            <Surface tool={tool} />
          </section>
        );
      })}
      {!contributors.length && (
        <EmptyState title="Nothing to show" mascot>
          Your installed tools have no recent activity yet.
        </EmptyState>
      )}
    </>
  );
}
