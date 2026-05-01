import "./document-editor.css";

export function DocumentSpotlightFrame({ children }: { children: React.ReactNode }) {
  const handleMouseMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
    const container = e.currentTarget;
    const editorEl = container.querySelector(".bn-editor");
    const containerRect = container.getBoundingClientRect();
    const editorRect = (editorEl ?? container).getBoundingClientRect();
    container.style.setProperty("--editor-left", `${editorRect.left - containerRect.left}px`);
    container.style.setProperty("--editor-width", `${editorRect.width}px`);
    container.style.setProperty("--mx", `${e.clientX - editorRect.left}px`);
    container.style.setProperty("--my", `${e.clientY - editorRect.top}px`);
  };

  return (
    <div
      className="document-spotlight-frame px-2 sm:px-14 max-w-full"
      onMouseMove={handleMouseMove}
    >
      {children}
    </div>
  );
}
