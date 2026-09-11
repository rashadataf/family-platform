/**
 * Case-insensitive by construction (FR-022): normalising here, once, at the
 * one place every email enters or leaves the domain, is what makes
 * `User@Example.com` and `user@example.com` the same account everywhere else
 * in this context without every call site having to remember to normalise.
 */
export class EmailAddress {
  private constructor(private readonly normalised: string) {}

  static from(raw: string): EmailAddress {
    return new EmailAddress(raw.trim().toLowerCase());
  }

  get value(): string {
    return this.normalised;
  }

  equals(other: EmailAddress): boolean {
    return this.normalised === other.normalised;
  }

  toString(): string {
    return this.normalised;
  }
}
