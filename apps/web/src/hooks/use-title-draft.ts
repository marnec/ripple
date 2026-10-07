import { useState } from "react";

/**
 * A title as the user is editing it, kept in step with the server — the task
 * title field and every `InlineTitleField`.
 *
 * The draft follows the server title whenever that changes (the resource
 * loads, the sheet switches task, a collaborator renames it), but is otherwise
 * the user's. Render-time derived state rather than an effect, per the React docs'
 * "adjusting state when a prop changes".
 *
 * Both pieces of state start from the *current* server title. A task is
 * often already in the query cache on the first render (opened from the
 * board, or the sheet expanded to the page); seeding only the "previous"
 * title from it, as this once did, made the two agree from the start, so the
 * sync never fired and the field stayed empty.
 */
export function useTitleDraft(serverTitle: string | undefined) {
  const [draft, setDraft] = useState(serverTitle ?? "");
  const [prevServerTitle, setPrevServerTitle] = useState(serverTitle);
  if (serverTitle !== prevServerTitle) {
    setPrevServerTitle(serverTitle);
    if (serverTitle && serverTitle !== draft) {
      setDraft(serverTitle);
    }
  }
  return [draft, setDraft] as const;
}
