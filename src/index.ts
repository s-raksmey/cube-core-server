import { createServer } from "node:http";
import { createYoga } from "graphql-yoga";
import { schema } from "@/src/graphql/resolvers";
import { createContext, type GraphQLContext } from "@/src/graphql/context";

const port = Number(process.env.PORT ?? 4000);

const yoga = createYoga<GraphQLContext>({
  schema,
  context: createContext,
  graphqlEndpoint: "/graphql",
  maxRequestBodySize: 1_000_000,
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

const server = createServer(yoga);

server.listen(port, () => {
  console.log(`Cube Core GraphQL ready at http://localhost:${port}/graphql`);
});
