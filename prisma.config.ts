import { defineConfig } from "prisma/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrate: {
    async adapter(env: NodeJS.ProcessEnv) {
      const pool = new Pool({ connectionString: env["DIRECT_URL"] ?? env["DATABASE_URL"] });
      return new PrismaPg(pool);
    },
  },
});