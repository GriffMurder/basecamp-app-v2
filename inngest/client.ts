/**
 * inngest/client.ts
 * Shared Inngest client instance — import this in every function file.
 */
import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "basecamp-app",
  name: "Basecamp App",
  eventKey: process.env.INNGEST_EVENT_KEY,
});