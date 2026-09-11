import { createAzure } from "@ai-sdk/azure";
import { Agent, type UsageHandler } from "@convex-dev/agent";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * Every model call in the app is made through an `@convex-dev/agent` Agent
 * built here. One factory rather than a `createAnthropic` at each call site:
 * the model id, the provider client and the token accounting are the parts
 * that must not drift between surfaces, and they are exactly the parts a call
 * site has no reason to restate.
 *
 * No Convex function lives here and nothing in it needs Node, so both callers
 * can import it: `aiDocumentAssistant.ts` is an HTTP action in the default
 * runtime, `chatAssistantAction.ts` is `"use node"` (for the headless editor,
 * not for this).
 *
 * **Threads are deliberately not used yet.** `Agent.streamText` /
 * `generateText` save messages only when handed a `threadId`, and the document
 * assistant has none: `@blocknote/xl-ai` keeps its own history and resends it
 * whole on every request, so a thread would be a second copy rather than the
 * source of truth. The usage handler fires either way — it is called outside
 * the thread-gated save in the component — which is the whole reason the
 * agent is here. The chat assistant does keep a thread
 * (`assistantChannelThreads`), and passes it.
 *
 * Set the credentials with:
 *   npx convex env set AZURE_API_KEY <value>
 *   npx convex env set AZURE_RESOURCE_NAME <value>
 *   npx convex env set AZURE_OPENAI_DEPLOYMENT <value>
 */

/** Which feature made the call. Recorded on every usage row. */
export const AiSurface = {
  /** The in-editor writing assistant (`aiDocumentAssistant.ts`). */
  DOCUMENT_ASSISTANT: "document_assistant",
  /** The workspace bot that answers an @-mention in chat (`chatAssistant.ts`). */
  CHAT_ASSISTANT: "chat_assistant",
} as const;

export type AiSurface = (typeof AiSurface)[keyof typeof AiSurface];

/**
 * What one Azure OpenAI call needs. Azure addresses a *deployment*, not a
 * model: the same GPT release is reached under whatever name it was given in
 * the resource, and that name differs between the dev and prod resources. So
 * unlike a first-party provider — where the model id is a constant the code
 * can own — the identifier has to come from the environment, and `aiUsage.model`
 * records the deployment name rather than the underlying model.
 *
 * Both surfaces read the same three variables, which is what keeps them on one
 * model: there is no per-surface override to drift.
 */
export interface AiConfig {
  apiKey: string;
  /** The Azure OpenAI resource, i.e. the `X` in `X.openai.azure.com`. */
  resourceName: string;
  /** The deployment name within that resource. */
  deployment: string;
}

/**
 * Read the config, or `null` when the deployment has not been given one.
 *
 * Read per call rather than at module load: a missing variable must fail the
 * one request that needed it — as a 503 in the document route, as a
 * non-retryable job failure in chat — not every function in the module at
 * import time. Returning `null` rather than throwing is what lets each caller
 * choose which of those it is.
 */
export function readAiConfig(): AiConfig | null {
  const apiKey = process.env.AZURE_API_KEY;
  const resourceName = process.env.AZURE_RESOURCE_NAME;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  if (!apiKey || !resourceName || !deployment) return null;
  return { apiKey, resourceName, deployment };
}

/**
 * Write one `aiUsage` row per model round trip. The component calls this once
 * per step, which is once per billed request to the provider, so a multi-step
 * document edit lands as several rows rather than one — that is the honest
 * shape, since each step is charged separately and re-sends the context.
 *
 * A failure here must not take the generation with it: for the document
 * assistant this runs inside `onStepFinish` while the HTTP response is still
 * streaming to the editor, so throwing would break a stream the user is
 * watching over a row nobody is waiting on.
 */
export function recordUsage(
  surface: AiSurface,
  workspaceId: Id<"workspaces">,
): UsageHandler {
  return async (ctx, { userId, model, provider, usage }) => {
    try {
      await ctx.runMutation(internal.aiUsage.record, {
        workspaceId,
        userId: (userId ?? undefined) as Id<"users"> | undefined,
        surface,
        provider,
        model,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
        cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens,
        cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens,
        reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
      });
    } catch (error) {
      console.error("Failed to record AI usage", error);
    }
  };
}

/**
 * The agent for one request. Built per call rather than at module load: the
 * provider client needs the credentials, and the usage handler needs the
 * workspace the call is being made for, neither of which exists at import
 * time.
 *
 * `maxSteps` is the component's spelling of `stopWhen: stepCountIs(n)` — it is
 * applied as exactly that when no `stopWhen` is given at the call site.
 */
export function createAgent(options: {
  surface: AiSurface;
  workspaceId: Id<"workspaces">;
  config: AiConfig;
  /** Attributed on the messages the agent writes. */
  name: string;
  instructions: string;
  maxSteps: number;
  maxOutputTokens: number;
}) {
  const azure = createAzure({
    apiKey: options.config.apiKey,
    resourceName: options.config.resourceName,
  });
  return new Agent(components.agent, {
    name: options.name,
    // `.chat` is Chat Completions; the provider's bare `azure(...)` would be
    // the Responses API instead. Chat Completions is the surface every Azure
    // deployment serves regardless of vintage, and it carries the multi-step
    // tool calling both assistants depend on. Switch this to `.responses(...)`
    // if the deployment is a reasoning model whose thinking you want back.
    languageModel: azure.chat(options.config.deployment),
    // The deployment is a GPT-5-family reasoning model, and the provider has
    // to be told so: it guesses from the model id, which on Azure is the
    // deployment *name* — whatever the resource called it — not the model.
    // `forceReasoning` sends `max_completion_tokens` and the `developer` role
    // and drops the sampling parameters these models reject, instead of
    // leaving that to a guess about the name. `low` effort is the right amount
    // for short structured edits and short chat replies: some deliberation
    // over the schema, no plan. Reasoning tokens bill as output;
    // `aiUsage.reasoningTokens` shows what it costs.
    providerOptions: { openai: { forceReasoning: true, reasoningEffort: "low" } },
    instructions: options.instructions,
    maxSteps: options.maxSteps,
    callSettings: { maxOutputTokens: options.maxOutputTokens },
    usageHandler: recordUsage(options.surface, options.workspaceId),
  });
}
