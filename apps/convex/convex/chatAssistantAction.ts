"use node";

import { NonRetryableError } from "@convex-dev/workpool";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { AiSurface, createAgent, readAiConfig } from "./lib/aiAgents";
import {
  ASSISTANT_MAX_OUTPUT_TOKENS,
  assistantInstructions,
  renderTranscript,
} from "./lib/chatAssistant";
import { markdownToBlocks } from "./lib/headlessEditor";

/**
 * The model call behind one assistant reply. Node runtime because the answer
 * comes back as markdown and becomes a chat message through the headless
 * BlockNote editor (`lib/headlessEditor`), which needs a DOM.
 *
 * Runs on `aiPool`. Everything before and after the call is a Convex function
 * in the default runtime: `loadReplyContext` reads, `postReply` writes. The
 * action itself owns nothing but the request.
 *
 * The agent comes from `lib/aiAgents`, the same factory the document assistant
 * uses, so both surfaces share one deployment, one provider client and one
 * token accounting path. It is built per call rather than at module load: the
 * model client needs the Azure credentials, which are read here so a deployment
 * without them fails the job at its first attempt (`NonRetryableError`) instead
 * of at import time for every function in the module.
 */
export const reply = internalAction({
  args: { messageId: v.id("messages") },
  returns: v.null(),
  handler: async (ctx, { messageId }) => {
    const context = await ctx.runQuery(internal.chatAssistant.loadReplyContext, {
      messageId,
    });
    if (!context) return null;

    const config = readAiConfig();
    if (!config) {
      throw new NonRetryableError(
        "AZURE_API_KEY, AZURE_RESOURCE_NAME or AZURE_OPENAI_DEPLOYMENT is not set",
      );
    }

    const agent = createAgent({
      surface: AiSurface.CHAT_ASSISTANT,
      workspaceId: context.workspaceId,
      config,
      name: context.botName,
      instructions: assistantInstructions({
        assistantName: context.botName,
        workspaceName: context.workspaceName,
        channelName: context.channelName,
      }),
      // No tools yet, so a single step is the whole answer.
      maxSteps: 1,
      maxOutputTokens: ASSISTANT_MAX_OUTPUT_TOKENS,
    });

    const result = await agent.generateText(
      ctx,
      { threadId: context.threadId, userId: context.senderUserId },
      { prompt: renderTranscript(context.transcript) },
    );

    const text = result.text.trim();
    if (text.length === 0) return null;

    const blocks = await markdownToBlocks(text);
    if (blocks.length === 0) return null;

    await ctx.runMutation(internal.chatAssistant.postReply, {
      messageId,
      body: JSON.stringify(blocks),
      plainText: text,
    });
    return null;
  },
});
