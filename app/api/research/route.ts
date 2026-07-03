/**
 * POST /api/research
 * HTTP + streaming layer only. All business logic lives in researchGraph.ts.
 */

import { z } from "zod";
import {
  runResearchGraph,
  type ResearchUpdate,
} from "@/lib/graph/researchGraph";

// Tell Vercel to allow up to 60 seconds for this route.
// The pipeline (Tavily × 3 + Groq) can take 30-50 s end-to-end.
export const maxDuration = 60;

// Validation schema
const requestSchema = z.object({
  // Trim before length-checking so "  " is caught as empty.
  company: z
    .string()
    .trim()
    .min(1, "Company name cannot be empty")
    .max(200, "Company name too long"),
});

// Streaming helpers
const encoder = new TextEncoder();

/** Serialise one update to NDJSON bytes (JSON + newline). */
function encodeChunk(
  update: ResearchUpdate | Record<string, unknown>,
): Uint8Array {
  return encoder.encode(JSON.stringify(update) + "\n");
}

// Route handler
export async function POST(request: Request): Promise<Response> {
  // --- 1. Parse & validate body ---
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Request body must be valid JSON" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    // Zod v4: flatten() is still available; use it for a concise error message.
    const messages = parsed.error.issues.map((i) => i.message).join("; ");
    return new Response(JSON.stringify({ error: messages }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { company } = parsed.data;

  // --- 2. Build the NDJSON stream ---
  // ReadableStream.start() is synchronous, so we wrap async work in an IIFE
  // to use await without blocking the constructor.
  const stream = new ReadableStream({
    start(controller) {
      (async () => {
        try {
          // Protocol preamble — lets the client render a "starting…" state immediately.
          controller.enqueue(
            encodeChunk({ step: "start", status: "running", company }),
          );

          // Drive the generator, forwarding every yielded update verbatim.
          for await (const update of runResearchGraph(company)) {
            controller.enqueue(encodeChunk(update));
          }

          // Explicit terminal frame so clients know the stream ended cleanly.
          controller.enqueue(encodeChunk({ step: "done", status: "complete" }));
        } catch (err) {
          // Surface errors as a stream frame rather than an abrupt close,
          // so clients can display a human-readable message.
          const message = err instanceof Error ? err.message : "Unknown error";
          controller.enqueue(
            encodeChunk({ step: "error", status: "failed", message }),
          );
        } finally {
          // Always close — even if an error was already enqueued above.
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      // text/plain keeps it simple; application/x-ndjson is the more correct MIME type
      // but some proxies buffer it — text/plain flushes reliably in all environments.
      "Content-Type": "text/plain; charset=utf-8",
      // Prevent any intermediary (CDN, browser) from caching a live stream.
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
