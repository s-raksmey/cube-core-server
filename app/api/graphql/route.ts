import type { NextRequest } from "next/server";
import { createYoga } from "graphql-yoga";
import { schema } from "@/src/graphql/resolvers";
import { createContext } from "@/src/graphql/context";

const yoga = createYoga({
  schema,
  context: createContext,
  graphqlEndpoint: "/api/graphql",
  fetchAPI: { Response },
  cors: {
    origin: [
      process.env.ADMIN_APP_URL ?? "http://localhost:3000",
      process.env.TENANT_APP_URL ?? "http://localhost:3001",
    ],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "OPTIONS"],
  },
});

export function GET(request: NextRequest) {
  return yoga.fetch(request);
}

export function POST(request: NextRequest) {
  return yoga.fetch(request);
}

export function OPTIONS(request: NextRequest) {
  return yoga.fetch(request);
}
