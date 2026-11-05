/**
 * The plugin's single failure vocabulary.
 *
 * It lives in its own module because both halves of the route layer need it —
 * the handlers raise it, the transport maps it to a status line — and a cycle
 * between those two files would be worse than one tiny module.
 *
 * The fields are assigned explicitly rather than declared as constructor
 * parameter properties: Node's native type stripping, which is how this repo's
 * tests run with no bundler in between, rejects that one TypeScript construct,
 * and the route layer has to stay importable from a test.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  /**
   * The figures the code's sentence needs, not part of any sentence.
   *
   * The panel says what a failure was in the reader's language, keyed by
   * {@link code}; it cannot say "at most 400 days" without knowing 400. Sending
   * the number rather than a formatted message is what keeps the *words* on the
   * side that knows the language — and an unknown code still degrades to the
   * host's own `message`, so this never has to be exhaustive.
   */
  readonly params?: Record<string, string | number>

  constructor(status: number, code: string, message: string, params?: Record<string, string | number>) {
    super(message)
    this.status = status
    this.code = code
    if (params !== undefined) this.params = params
  }
}
