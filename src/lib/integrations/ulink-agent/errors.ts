// Thrown by the store layer when a row doesn't exist OR the authenticated user
// doesn't own it. Routes map this to 404 (we deliberately don't distinguish
// "missing" from "not yours" so ownership can't be probed by id enumeration).
export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

// Thrown when a request body fails validation against the shared unions.
// Routes map this to 400.
export class ValidationError extends Error {
  constructor(message = "Invalid request") {
    super(message);
    this.name = "ValidationError";
  }
}
