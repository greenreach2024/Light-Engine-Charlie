import dotenv from "dotenv";

dotenv.config();

export type AppConfig = {
  port: number;
  databaseUrl: string;
  matchQueueName: string;
};

export const loadConfig = (): AppConfig => {
  const port = Number(process.env.PORT ?? "4000");
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://user:pass@localhost:5432/buyer_registry";
  const matchQueueName = process.env.MATCH_QUEUE_NAME ?? "match-requests";

  return { port, databaseUrl, matchQueueName };
};
