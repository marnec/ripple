// The document assistant's client half: BlockNote's AI extension pointed at
// Ripple's own route.
//
// `@blocknote/xl-ai` owns everything the user sees — the AI menu, the streamed
// suggestions, accept / reject — and speaks the AI SDK chat protocol to a
// backend of our choosing. Ours is the `/ai/document` HTTP action on Convex
// (see `convex/aiDocumentAssistant.ts`), which is where the model runs and
// where it gets its read access to the rest of the workspace.
//
// In a collaborative editor the extension forks the Y.Doc for the duration of
// a request and merges the accepted result back as one update, so other
// people in the document see nothing until the user accepts.

import { AIExtension } from "@blocknote/xl-ai";
import { DefaultChatTransport } from "ai";

/**
 * The Convex *site* URL, where HTTP actions live. Configured explicitly in
 * `.env`; falls back to deriving it from the client URL for a deployment that
 * predates the variable.
 */
export function convexSiteUrl(): string {
  const explicit = import.meta.env.VITE_CONVEX_SITE_URL as string | undefined;
  if (explicit) return explicit.replace(/\/$/, "");
  const cloud = import.meta.env.VITE_CONVEX_URL as string;
  return cloud.replace(".convex.cloud", ".convex.site").replace(/\/$/, "");
}

/** The cursor other people would see if the AI were a person. */
const AGENT_CURSOR = { name: "Ripple AI", color: "#8bc6ff" };

export interface DocumentAI {
  /** Hand to the editor's `extensions`. One array, so its identity is stable. */
  extensions: [ReturnType<typeof AIExtension>];
  /**
   * The auth token the next request will carry. Pushed in from the component
   * as the token rotates, rather than captured: the extension's identity has to
   * stay stable or the editor is recreated underneath an in-flight request.
   */
  setToken: (token: string | null) => void;
}

/** Build the AI extension for one document. */
export function createDocumentAI({ documentId }: { documentId: string }): DocumentAI {
  let token: string | null = null;
  const transport = new DefaultChatTransport({
    api: `${convexSiteUrl()}/ai/document`,
    // `body` here is what the extension attaches (the tool definitions); the
    // default request shape is rebuilt on top of it because providing this
    // hook replaces the transport's own body entirely.
    prepareSendMessagesRequest: ({ id, messages, body, headers, trigger, messageId }) => ({
      headers: {
        ...(headers as Record<string, string> | undefined),
        Authorization: `Bearer ${token ?? ""}`,
      },
      body: { ...body, id, messages, trigger, messageId, documentId },
    }),
  });

  return {
    extensions: [AIExtension({ transport, agentCursor: AGENT_CURSOR })],
    setToken: (next) => {
      token = next;
    },
  };
}
