/*
(1.) HTTP API routes for external access to deletion job status
(2.) Provides REST endpoint for monitoring batch deletion progress
(3.) Enables integration with external monitoring tools and webhooks

This module defines HTTP routes that expose batch deletion job status via a REST
API. The primary use case is enabling external tools, dashboards, or webhook
consumers to poll deletion progress without requiring a Convex client SDK. The
endpoint accepts a job ID as a query parameter and returns the current job status
as JSON, including completion progress and summary information.
*/

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server.js";
import { components } from "./_generated/api.js";

const http = httpRouter();

http.route({
  path: "/api/deletion-job-status",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");

    if (!jobId) {
      return new Response(
        JSON.stringify({ error: "Missing jobId query parameter" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const status = await ctx.runQuery(
      components.convexCascadingDelete.lib.getJobStatus,
      { jobId }
    );

    if (!status) {
      return new Response(
        JSON.stringify({ error: "Job not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(status), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
