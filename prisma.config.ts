import { defineConfig } from "prisma/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

export default defineConfig({
  schema: "prisma/schema.prisma",
  adapter: async () => {
    const pool = new Pool({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
    return new PrismaPg(pool);
  },
});