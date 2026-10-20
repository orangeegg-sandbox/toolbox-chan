import { useToolbox } from "../ToolboxContext";
import { ThemeSettings } from "../components/ThemeSettings";
import { FontSizeSettings } from "../components/FontSizeSettings";

export function ContributionsPage({
  surface,
}: {
  surface: "Settings" | "Activity";
}) {
  const { tools } = useToolbox();
  const settings = surface === "Settings";
  const contributors = tools.filter((tool) => tool[surface]);
  return (
    <>
      <div className="section-eyebrow">
        {settings ? "MAKE YOURSELF AT HOME" : "PICK UP WHERE YOU LEFT OFF"}
      </div>
      <h1>{settings ? "Settings" : "Recent activity"}</h1>
      <p className="page-intro">
        {settings
          ? "Preferences for your toolbox and its tools."
          : "Pick up where you left off in your tools."}
      </p>
      {settings && (
        <>
          <ThemeSettings />
          <FontSizeSettings />
        </>
      )}
      {contributors.map((tool) => {
        const Surface = tool[surface]!;
        return (
          <section
            className="tool-contribution"
            key={tool.id}
            aria-label={`${tool.name} ${surface.toLowerCase()}`}
          >
            <Surface tool={tool} />
          </section>
        );
      })}
      {!contributors.length && (
        <div className="empty-view">
          <p>
            {settings
              ? "Your installed tools have no settings yet."
              : "Your installed tools have no recent activity yet."}
          </p>
        </div>
      )}
    </>
  );
}
