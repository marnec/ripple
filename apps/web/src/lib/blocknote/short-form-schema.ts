// The block set shared by Ripple's short-form composers: channel messages,
// document comments and task comments.
//
// These three are one class of surface — a few lines of prose aimed at a
// person, not a document — so they carry one restriction set rather than three
// that drift apart. It is deliberately narrower than the writing surfaces'
// (`rich-text-schema.ts`):
//
//  - **No media at all** — `file`, `audio`, `video` *and* `image`. None of
//    these composers passes `uploadFile` to BlockNote, so there is no upload
//    path behind the blocks either; dropping a file is inert (BlockNote's
//    drop handler returns before inserting when `uploadFile` is unset).
//    Chat's *attachments* are a separate, message-level feature that never
//    goes through this schema — the composer writes an `image` or a `file`
//    block into the message body at send time, and `MessageRenderer` pulls it
//    back out and draws it. Authoring and rendering are different paths here;
//    this one is authoring, which is why the blocks stay out even though a
//    channel message can carry one.
//  - **No headings.** A heading inside a chat message or a comment is
//    structure the surrounding UI already provides.
//
// Embedding other resources (documents, spreadsheets, diagrams) is *not*
// decided here — it is per-surface inline content. Chat opts in; the two
// comment schemas deliberately do not, and `short-form-schema.test.ts` holds
// them to it.

import { defaultBlockSpecs } from "@blocknote/core";

const {
  audio: _audio,
  video: _video,
  file: _file,
  image: _image,
  heading: _heading,
  ...shortForm
} = defaultBlockSpecs;

/** Default block specs minus every media block and headings. */
export function shortFormBlockSpecs() {
  return { ...shortForm };
}
