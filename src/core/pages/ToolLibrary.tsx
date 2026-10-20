import { ArrowRight, Layers3 } from "lucide-react";
import { useToolbox } from "../ToolboxContext";

export function ToolLibrary() {
  const { tools, openTool } = useToolbox();
  return (
    <>
      <div className="section-eyebrow">A LITTLE HELP, EVERY DAY</div>
      <h1>Your everyday, a little easier.</h1>
      <p className="page-intro">
        A home for the small tools that make a big difference.
      </p>
      <div className="library-heading">
        <h2>
          All tools{" "}
          <span className="small-tag">
            {String(tools.length).padStart(2, "0")}
          </span>
        </h2>
        <span>Built to do one thing well.</span>
      </div>
      <div className="tool-cards">
        {tools.map((tool) => (
          <button
            className="tool-card"
            key={tool.id}
            onClick={() => openTool(tool.id)}
          >
            <div className="tool-card-top">
              <span className="heading-icon">
                <tool.icon size={26} />
              </span>
              <span className="small-tag">READY TO USE</span>
            </div>
            <h2>{tool.name}</h2>
            <p>{tool.description}</p>
            <div>
              <span>{tool.category}</span>
              <ArrowRight size={17} />
            </div>
          </button>
        ))}
        <div className="future-card">
          <Layers3 size={28} strokeWidth={1.2} />
          <h3>Room for your next idea.</h3>
          <p>More utilities and custom macros can live here.</p>
          <span>YOUR TOOLBOX, GROWING WITH YOU</span>
        </div>
      </div>
    </>
  );
}
