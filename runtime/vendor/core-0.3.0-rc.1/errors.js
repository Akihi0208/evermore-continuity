export class ContinuityError extends Error {
    constructor(message) {
        super(message);
        this.name = "ContinuityError";
    }
}
export class ValidationError extends ContinuityError {
    constructor(message) {
        super(message);
        this.name = "ValidationError";
    }
}
export class DuplicateRecordError extends ContinuityError {
    constructor(kind, id) {
        super(`${kind} with id ${id} already exists`);
        this.name = "DuplicateRecordError";
    }
}
//# sourceMappingURL=errors.js.map