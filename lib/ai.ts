/**
 * lib/ai.ts
 * Vercel AI SDK provider setup — xAI Grok (primary) with OpenAI fallback.
 * Mirrors app/ai_brain/__init__.py safe_chat_completion() behaviour.
 */

import { createXai } from "@ai-sdk/xai";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, streamText } from "ai";

// ── Provider instances ────────────────────────────────────────────────────────

function xaiProvider() {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error("XAI_API_KEY is not set");
  return createXai({ apiKey });
}

function openaiProvider() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return createOpenAI({ apiKey });
}

// ── Chat message type ─────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ── Safe completions ──────────────────────────────────────────────────────────

/**
 * Non-streaming completion with automatic xAI → OpenAI fallback.
 * Returns the full text or null on failure.
 */
export async function safeChatCompletion(
  messages: ChatMessage[],
  opts: {
    model?: string;
    temperature?: number;
  } = {}
): Promise<string | null> {
  const { model = "grok-3", temperature = 0.3 } = opts;

  // Try xAI first
  try {
    const result = await generateText({
      model: xaiProvider()(model),
      messages,
      temperature,
    });
    return result.text;
  } catch (err) {
    console.warn("[ai] xAI failed, falling back to OpenAI:", err);
  }

  // Fallback to OpenAI
  try {
    const result = await generateText({
      model: openaiProvider()("gpt-4o"),
      messages,
      temperature,
    });
    return result.text;
  } catch (err) {
    console.error("[ai] OpenAI fallback also failed:", err);
    return null;
  }
}

/**
 * Streaming completion — yields text deltas.
 */
export async function streamChatCompletion(
  messages: ChatMessage[],
  opts: { model?: string } = {}
) {
  const { model = "grok-3" } = opts;
  try {
    return await streamText({ model: xaiProvider()(model), messages });
  } catch {
    return await streamText({ model: openaiProvider()("gpt-4o"), messages });
  }
}