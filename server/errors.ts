/** An error that is safe to show to the client, with the HTTP status to use. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
