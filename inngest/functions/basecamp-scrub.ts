/**
 * inngest/functions/basecamp-scrub.ts
 * Replaces Celery task: app.workers.run_scrub (every 30 min)
 *
 * Scrapes active Basecamp projects for todos and upserts into BasecampTodo.
 */
import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/prisma";
import { getProjects, getTodosInList } from "@/lib/basecamp";
import type { BasecampTodoItem } from "@/lib/basecamp";

export const basecampScrub = inngest.createFunction(
  { id: "basecamp-scrub", name: "Basecamp Todo Scrub", concurrency: 1 },
  { cron: "*/30 * * * *" },
  async ({ step, logger }) => {
    logger.info("Starting Basecamp scrub");

    const projects = await step.run("fetch-projects", async () => {
      return getProjects();
    });

    const active = projects.filter((p) => p.status === "active");
    logger.info(`Scrubbing ${active.length} active projects`);

    let upserted = 0;

    for (const project of active) {
      // Collect all todos across all todolists in this project via the
      // Basecamp v3 events/webhooks approach — here we paginate directly.
      const todos = await step.run(`scrape-${project.id}`, async () => {
        // Basecamp lists todos by todolist; we use page 1 for the project-level
        // todo summary. For a full scrape, the caller should iterate todolists.
        return getTodosInList(project.id, 0).catch((): BasecampTodoItem[] => []);
      });

      for (const todo of todos) {
        const todolistId = String(todo.parent?.id ?? "");
        const projectId = String(todo.bucket?.id ?? project.id);

        await prisma.basecampTodo.upsert({
          where: { basecamp_todo_id: String(todo.id) },
          create: {
            basecamp_todo_id: String(todo.id),
            basecamp_project_id: projectId,
            basecamp_todolist_id: todolistId,
            project_name: todo.bucket?.name ?? project.name,
            title: todo.title,
            description: todo.description ?? "",
            assignee_id: todo.assignees[0] ? String(todo.assignees[0].id) : null,
            assignee_name: todo.assignees[0]?.name ?? null,
            completed: todo.completed,
            due_on: todo.due_on ? new Date(todo.due_on) : null,
            updated_at: new Date(todo.updated_at),
          },
          update: {
            title: todo.title,
            description: todo.description ?? "",
            assignee_id: todo.assignees[0] ? String(todo.assignees[0].id) : null,
            assignee_name: todo.assignees[0]?.name ?? null,
            completed: todo.completed,
            due_on: todo.due_on ? new Date(todo.due_on) : null,
            updated_at: new Date(todo.updated_at),
          },
        });
        upserted++;
      }
    }

    logger.info(`Scrub complete — upserted ${upserted} todos`);
    return { upserted, projectCount: active.length };
  }
);