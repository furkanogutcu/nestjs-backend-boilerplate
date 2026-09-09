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

  // ! Whoever reads this secret can mint valid codes forever; a database dump alone must not defeat MFA.
  @EncryptedColumn({ aad: 'mfa_credential_secret' })
  secret!: string;

  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  // * A fast hash is right here: recovery codes are high-entropy random strings, not passwords.
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  recoveryCodeHashes!: string[];

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
