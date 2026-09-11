/**
 * Generic infrastructure capability, not identity-specific — declared here
 * rather than under `core/identity/application/ports` because
 * `packages/platform` (which implements it) is forbidden from importing
 * `packages/core` at all (`platform-has-no-domain` in
 * `.dependency-cruiser.cjs`, ARCHITECTURE.md §6's dependency-inversion rule
 * applied to a capability more than one future context may need). The kernel
 * is the one package both `platform` and `core` may import.
 */
export interface PasswordHasherPort {
  hash(plaintext: string): Promise<string>;
  verify(plaintext: string, hash: string): Promise<boolean>;
}
