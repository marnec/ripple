// The block/inline-content specs shared by the two "rich writing" surfaces —
// the document editor and the task-description editor. Chat composes its own
// (much smaller) schema; comments compose theirs.
//
// Two deliberate deviations from BlockNote's defaults live here:
//
//  - **No `file` / `audio` / `video`.** Documents and task descriptions are for
//    writing, not for hosting media. Dropping the specs is what removes them
//    from the slash menu — the default items are derived from the schema, so
//    there is no separate menu list to keep in sync. `image` stays.
//    The schema does *not* cover the drag/paste path: BlockNote's file-drop
//    handler defaults to inserting a `file` block regardless of the schema, so
//    `useMediaDropGuard` blocks that event before it reaches ProseMirror.
//  - **Math.** `@blocknote/math-block` ships the KaTeX-backed block and inline
//    content, but as an optional package they are opt-in, both in the schema
//    (here) and in the slash menu (`getRichSlashMenuItems`) and dictionary
//    (`richTextDictionary`).
//
// Specs are produced by functions rather than shared constants so each schema
// owns its own instances, the way BlockNote's own examples create them inline.

import { defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { en as bnEn } from "@blocknote/core/locales";
import {
  createReactInlineMathSpec,
  createReactMathBlockSpec,
  locales as mathLocales,
} from "@blocknote/math-block";

const {
  audio: _audio,
  video: _video,
  file: _file,
  ...writingBlockSpecs
} = defaultBlockSpecs;

/** Default block specs minus the media blocks, plus the math block. */
export function richTextBlockSpecs() {
  return {
    ...writingBlockSpecs,
    mathBlock: createReactMathBlockSpec(),
  };
}

/** Default inline content specs, plus inline math. */
export function richTextInlineContentSpecs() {
  return {
    ...defaultInlineContentSpecs,
    math: createReactInlineMathSpec(),
  };
}

/**
 * Base dictionary for the writing surfaces. The math block/inline content read
 * their strings from the `math` key, which only exists if merged in here —
 * without it BlockNote falls back to the package's bundled English strings, so
 * this is what keeps them on the same localization path as everything else.
 * Callers spread this and override `placeholders`.
 */
export const richTextDictionary = {
  ...bnEn,
  math: mathLocales.en,
};
