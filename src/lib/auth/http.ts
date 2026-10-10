import { GraphQLError } from "graphql";

export function correlationIdFrom(request: Request) {
  return request.headers.get("x-correlation-id");
}

export function jsonError(error: unknown, fallbackStatus = 400) {
  if (error instanceof GraphQLError) {
    const ext = error.extensions?.code;
    const status =
      ext === "UNAUTHENTICATED" ? 401 : ext === "FORBIDDEN" ? 403 : 400;
    return Response.json({ error: error.message }, { status });
  }
  console.error(error);
  return Response.json({ error: "Request failed" }, { status: fallbackStatus });
}
