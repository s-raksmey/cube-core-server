import { GraphQLError } from "graphql";

export function unauthenticated(message = "Authentication required") {
  return new GraphQLError(message, {
    extensions: { code: "UNAUTHENTICATED" },
  });
}

export function forbidden(message = "Forbidden") {
  return new GraphQLError(message, {
    extensions: { code: "FORBIDDEN" },
  });
}

export function notFound(message = "Not found") {
  return new GraphQLError(message, {
    extensions: { code: "NOT_FOUND" },
  });
}

export function validationError(message: string) {
  return new GraphQLError(message, {
    extensions: { code: "VALIDATION" },
  });
}
