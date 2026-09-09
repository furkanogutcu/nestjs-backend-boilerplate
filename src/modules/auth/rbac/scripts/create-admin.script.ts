import { NestFactory } from '@nestjs/core';
import { hash } from '@node-rs/argon2';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';

import { generateUuid } from '@shared/utils/uuid.util';

import { AppModule } from '../../../../app.module';
import { User } from '../../entities/user.entity';
import { MfaService } from '../../mfa/services/mfa.service';
import { Role } from '../entities/role.entity';
import { UserRole } from '../entities/user-role.entity';
import { SUPERUSER_ROLE_NAME } from '../rbac.constant';

const TEMPORARY_PASSWORD_BYTES = 18;

function readArgument(name: string): string | undefined {
  const prefix = `--${name}=`;

  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

async function readPasswordFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8').trim();
}

async function run(): Promise<void> {
  const email = readArgument('email');

  if (!email) {
    console.error('Usage: pnpm admin:create --email=<address> [--display-name=<name>] [--password-stdin]');
    process.exit(1);
  }

  // ! Never accept the password as an argv value: it would land in shell history and in the process list.
  const usePasswordStdin = process.argv.includes('--password-stdin');
  const password = usePasswordStdin
    ? await readPasswordFromStdin()
    : randomBytes(TEMPORARY_PASSWORD_BYTES).toString('base64url');

  if (usePasswordStdin && password.length < 12) {
    console.error('❌ The password read from stdin is too short (minimum 12 characters).');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    const dataSource = app.get(DataSource);
    const mfaService = app.get(MfaService);

    const existing = await dataSource.getRepository(User).findOne({ where: { email } });

    if (existing) {
      console.error(`❌ A user with the email ${email} already exists.`);
      process.exit(1);
    }

    const role = await dataSource.getRepository(Role).findOne({ where: { name: SUPERUSER_ROLE_NAME } });

    if (!role) {
      console.error(
        `❌ The ${SUPERUSER_ROLE_NAME} role is missing. Run the application once so the permission sync can create it.`,
      );
      process.exit(1);
    }

    const userId = generateUuid();

    await dataSource.transaction(async (manager) => {
      await manager.insert(User, {
        id: userId,
        email,
        passwordHash: await hash(password),
        displayName: readArgument('display-name') ?? null,
        isAnonymous: false,
        // ! The operator has seen this password. Forcing a change makes the handover credential single-use.
        mustChangePassword: true,
        emailVerifiedAt: new Date(),
      });

      await manager.insert(UserRole, { userId, roleId: role.id });
    });

    const mfa = await mfaService.provisionConfirmed({ userId });

    console.log(`\n✅ Superuser created: ${email}`);

    if (!usePasswordStdin) {
      console.log(`\n   Temporary password: ${password}`);
      console.log('   The account must change it at first sign-in.');
    }

    console.log(`\n   MFA is already active — sign-in requires a code from the start.`);
    console.log(`   otpauth URI: ${mfa.otpauthUri}`);
    console.log(`   Secret:      ${mfa.secret}`);
    console.log(`\n   Recovery codes (shown once):`);
    mfa.recoveryCodes.forEach((code) => console.log(`     ${code}`));
    console.log('');
  } finally {
    await app.close();
  }
}

void run().catch((error) => {
  console.error('❌ Failed to create the superuser', error);
  process.exit(1);
});
