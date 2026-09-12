import { describe, expect, it } from 'vitest';
import { Argon2PasswordHasher } from './argon2-password-hasher.js';

describe('Argon2PasswordHasher', () => {
  it('produces a digest that verifies against the original plaintext', async () => {
    const hasher = new Argon2PasswordHasher();

    const digest = await hasher.hash('correct horse battery staple');

    await expect(hasher.verify('correct horse battery staple', digest)).resolves.toBe(true);
  });

  it('rejects an incorrect plaintext against a real digest', async () => {
    const hasher = new Argon2PasswordHasher();

    const digest = await hasher.hash('correct horse battery staple');

    await expect(hasher.verify('wrong password', digest)).resolves.toBe(false);
  });

  it('never stores the plaintext itself in the digest (SC-005)', async () => {
    const hasher = new Argon2PasswordHasher();
    const plaintext = 'correct horse battery staple';

    const digest = await hasher.hash(plaintext);

    expect(digest).not.toContain(plaintext);
  });

  it('produces a different digest for the same plaintext on each call (random salt)', async () => {
    const hasher = new Argon2PasswordHasher();

    const first = await hasher.hash('correct horse battery staple');
    const second = await hasher.hash('correct horse battery staple');

    expect(first).not.toBe(second);
  });
});
