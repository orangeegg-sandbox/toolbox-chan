import { Cloud } from "lucide-react";
import { useOcr } from "../OcrProvider";

export function OcrStatus() {
  const { engine } = useOcr();
  return (
    <div className={`privacy-pill ${engine === "online" ? "online-pill" : ""}`}>
      {engine === "online" ? (
        <>
          <Cloud size={13} />
          Online provider selected
        </>
      ) : (
        <>
          <span className="green-dot" />
          Local by default
        </>
      )}
    </div>
  );
}
