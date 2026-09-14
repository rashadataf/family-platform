/**
 * Case-insensitive by construction: normalising here, once, at the one place
 * every email enters or leaves a domain, is what makes `User@Example.com` and
 * `user@example.com` the same address everywhere else without every call site
 * having to remember to normalise.
 *
 * It lives in the kernel rather than in one context because two contexts now
 * depend on the same rule holding: Identity's account lookup (spec 006
 * FR-022) and Family's invitation acceptance (spec 008 — an invitation must be
 * acceptable by the address it was sent to whatever case it was typed in). A
 * second implementation would be a duplicated invariant, and a divergence
 * between the two would be a case-sensitivity leak in the invitation path.
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
