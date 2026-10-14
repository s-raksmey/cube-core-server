import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createYoga } from "graphql-yoga";
import { schema } from "@/src/graphql/resolvers";
import { createContext, type GraphQLContext } from "@/src/graphql/context";
import { startArticleScheduler } from "@/src/modules/articles/article-scheduler";

const port = Number(process.env.PORT ?? 4000);

const yoga = createYoga<GraphQLContext>({
  schema,
  context: createContext,
  graphqlEndpoint: "/graphql",
  // A 1,000 KB image is base64-encoded in the GraphQL mutation.
  maxRequestBodySize: 1_500_000,
  cors: {
    origin: [
      process.env.ADMIN_APP_URL ?? "http://localhost:3000",
      process.env.TENANT_APP_URL ?? "http://localhost:3001",
      process.env.WEBSITE_URL ?? "http://localhost:3002",
    ],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
    methods: ["GET", "POST", "OPTIONS"],
  },
});

const storageRoot = resolve(process.env.LOCAL_STORAGE_PATH ?? join(process.cwd(), "storage"));
const contentTypes: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (pathname.startsWith("/storage/")) {
    const filePath = resolve(storageRoot, pathname.slice("/storage/".length));
    if (!filePath.startsWith(`${storageRoot}\\`) && !filePath.startsWith(`${storageRoot}/`)) { res.writeHead(404).end(); return; }
    try {
      const content = await readFile(filePath);
      const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
      res.writeHead(200, { "Content-Type": contentTypes[extension] ?? "application/octet-stream", "Cache-Control": "public, max-age=3600" });
      res.end(content);
    } catch { res.writeHead(404).end(); }
    return;
  }
  return yoga(req, res);
});

server.listen(port, () => {
  console.log(`Cube Core GraphQL ready at http://localhost:${port}/graphql`);
  startArticleScheduler();
});
