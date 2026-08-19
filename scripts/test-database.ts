import { loadEnvConfig } from "@next/env";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

loadEnvConfig(process.cwd());

const connectionString = process.env.TEST_DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "TEST_DATABASE_URL is not set; refusing to smoke-test a non-isolated database"
  );
}

async function main() {
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    const [result] = await prisma.$queryRaw<
      Array<{ database: string; currentUser: string }>
    >`SELECT current_database() AS database, current_user AS "currentUser"`;

    console.log(
      `Connected to database "${result.database}" as role "${result.currentUser}".`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
