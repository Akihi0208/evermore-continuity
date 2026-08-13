export class ContinuityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContinuityError";
  }
}

export class ValidationError extends ContinuityError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class DuplicateRecordError extends ContinuityError {
  constructor(kind: string, id: string) {
    super(`${kind} with id ${id} already exists`);
    this.name = "DuplicateRecordError";
  }
}
