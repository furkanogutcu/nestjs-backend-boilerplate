import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { EncryptedColumn } from '@infrastructure/sensitive/encrypted-column.decorator';

import { User } from '../../entities/user.entity';

@Entity('mfa_credentials')
export class MfaCredential {
  @PrimaryColumn('uuid')
  userId!: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  // ! The TOTP shared secret is a second authentication factor at rest: whoever reads it can mint valid codes
  // ! forever. Encrypted with the application keyring so a database dump alone does not defeat MFA.
  @EncryptedColumn({ aad: 'mfa_credential_secret' })
  secret!: string;

  // * Null while enrolment is in progress. A credential only counts as MFA once the user has proved they can
  // * produce a code from it, so an abandoned enrolment can never lock anybody out.
  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  // * SHA-256 of each unused recovery code. These are high-entropy random strings, not passwords, so a fast
  // * hash is the right choice — there is nothing to brute-force. A used code is removed from the array.
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  recoveryCodeHashes!: string[];

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
