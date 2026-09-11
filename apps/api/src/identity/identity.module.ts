import { Module } from '@nestjs/common';
import {
  Argon2PasswordHasher,
  RandomTokenGenerator,
  SmtpMailer,
  SystemClock,
  createSmtpTransport,
} from '@fp/platform';
import { createIdentityUnitOfWork } from '@fp/persistence';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppEnv } from '../config/env.schema.js';
import { IdentityController } from './identity.controller.js';
import {
  CLOCK,
  IDENTITY_UNIT_OF_WORK,
  MAILER,
  PASSWORD_HASHER,
  TOKEN_GENERATOR,
} from './identity.tokens.js';

@Module({
  controllers: [IdentityController],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    { provide: TOKEN_GENERATOR, useClass: RandomTokenGenerator },
    { provide: IDENTITY_UNIT_OF_WORK, useFactory: () => createIdentityUnitOfWork() },
    {
      provide: MAILER,
      inject: [APP_CONFIG],
      useFactory: (config: AppEnv) =>
        new SmtpMailer(createSmtpTransport({ host: config.MAIL_HOST, port: config.MAIL_PORT })),
    },
  ],
  exports: [CLOCK, PASSWORD_HASHER, TOKEN_GENERATOR, MAILER, IDENTITY_UNIT_OF_WORK],
})
export class IdentityModule {}
