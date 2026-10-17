import type { ErrorRequestHandler, RequestHandler } from "express";
import { HttpError } from "../utils/HttpError";
import { ZodError } from "zod";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: "NOT_FOUND",
    message: `Route ${req.method} ${req.path} was not found`,
  });
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  // Zod validation errors
  if (error instanceof ZodError) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Request validation failed",
      details: { fields: error.flatten().fieldErrors },
    });
    return;
  }

  // Application errors with specific codes
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({
      error: error.details?.code ?? "REQUEST_ERROR",
      message: error.message,
      details: error.details,
    });
    return;
  }

  // PostgreSQL unique violation
  if (error?.code === "23505") {
    res.status(409).json({
      error: "UNIQUE_VIOLATION",
      message: "A record with the given values already exists",
    });
    return;
  }

  // PostgreSQL foreign key violation
  if (error?.code === "23503") {
    res.status(422).json({
      error: "FK_VIOLATION",
      message: "Referenced record does not exist or is invalid",
      details: { constraint: error.constraint },
    });
    return;
  }

  console.error("Unhandled API error:", error);

  res.status(500).json({
    error: "INTERNAL_SERVER_ERROR",
    message: "An unexpected error occurred",
  });
};
