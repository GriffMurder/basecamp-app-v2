/**
 * lib/ai-client-updates.ts
 * Port of app/ai_client_updates.py
 *
 * Generates a friendly client-facing update message when a VA claims a task.
 * Uses AI (xai grok or openai fallback). Falls back to a canned template on error.
 *
 * Env:
 *   USE_AI_CLIENT_UPDATES  – set to "false" to disable AI and always use fallback
 *   AI_PROVIDER            – "grok" (default) or "openai"
 *   XAI_API_KEY            – required when AI_PROVIDER=grok
 *   OPENAI_API_KEY         – required when AI_PROVIDER=openai
 */

import { generateText } from "ai";
import { xai } from "@ai-sdk/xai";
import { openai } from "@ai-sdk/openai";

function getModel() {
  const provider = (process.env.AI_PROVIDER ?? "grok").toLowerCase();
  if (provider === "openai") return openai("gpt-4o-mini");
  return xai("grok-3-mini");
}

function fallbackMessage(claimerName: string, title: string, dueDate?: string): string {
  let msg =
    `Hi there! This is ${claimerName} from TaskBullet.\n\n` +
    `I've just picked up your task: "${title}". ` +
    `I'll get to work on this and keep you posted as I make progress. ` +
    `If you have any extra details or examples you want to share, feel free to reply and I'll incorporate them.`;
  if (dueDate) {
    msg += ` I'm targeting about ${dueDate} to have this wrapped up for you.`;
  }
  return msg;
}

export interface ClientUpdateArgs {
  claimerName: string;
  todoTitle: string;
  todoDescription?: string | null;
  dueDate?: string | null;
}

/**
 * Generate a friendly client-facing status update for a newly claimed task.
 * Falls back to a canned template if AI is disabled or unavailable.
 */
export async function generateClientUpdate(args: ClientUpdateArgs): Promise<string> {
  const { claimerName, todoTitle, todoDescription, dueDate } = args;
  const title = todoTitle?.trim() || "your task";

  const enabled = process.env.USE_AI_CLIENT_UPDATES !== "false";
  const hasKey = !!(process.env.XAI_API_KEY || process.env.OPENAI_API_KEY);

  if (!enabled || !hasKey) {
    return fallbackMessage(claimerName, title, dueDate ?? undefined);
  }

  const systemPrompt =
    "You are an assistant for TaskBullet, a virtual assistant company. " +
    "Generate a short, friendly client-facing status update about a newly claimed task. " +
    "Keep it professional but warm. No emojis.";

  let userPrompt = `Assistant name: ${claimerName}\nTask title: ${title}\n`;
  if (todoDescription?.trim()) {
    userPrompt += `Task details: ${todoDescription.trim().slice(0, 300)}\n`;
  }
  if (dueDate) {
    userPrompt += `Target due date: ${dueDate}\n`;
  }
  userPrompt +=
    "\nWrite 2-4 sentences as if you are the assistant, speaking to the client. " +
    "Acknowledge that you've picked up the task and briefly describe what you'll do next.";

  try {
    const { text } = await generateText({
      model: getModel(),
      system: systemPrompt,
      prompt: userPrompt,
      maxOutputTokens: 200,
    });
    if (text?.trim()) return text.trim();
  } catch {
    // fall through to fallback
  }

  return fallbackMessage(claimerName, title, dueDate ?? undefined);
}
