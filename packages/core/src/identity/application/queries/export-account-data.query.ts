import { err, ok, type DomainError, type Result, type UserId } from '@fp/kernel';
import type { IdentityUnitOfWorkPort } from '../ports/identity-unit-of-work.port.js';
import type { ExportedSessionSummary } from '../ports/session.repository.js';

export interface ExportAccountDataInput {
  userId: UserId;
}

export interface ExportAccountDataDeps {
  unitOfWork: IdentityUnitOfWorkPort;
}

/**
 * FR-021's exact field list (data-model.md's Export section) — never
 * `password_hash`, a token hash, or any verification token. Each of those
 * is either a credential or a usable bearer token, and exporting one would
 * be a disclosure dressed as a data-subject right.
 */
export interface AccountExport {
  email: string;
  registeredAt: Date;
  verified: boolean;
  sessions: ExportedSessionSummary[];
}

export async function exportAccountData(
  input: ExportAccountDataInput,
  deps: ExportAccountDataDeps,
): Promise<Result<AccountExport, DomainError>> {
  return deps.unitOfWork.run(async (uow): Promise<Result<AccountExport, DomainError>> => {
    const user = await uow.users.findById(input.userId);
    if (!user) {
      return err({ kind: 'NotFound' });
    }

    const sessions = await uow.sessions.listExportSummariesByUserId(input.userId);

    return ok({
      email: user.email.value,
      registeredAt: user.createdAt,
      verified: user.isVerified,
      sessions,
    });
  });
}
