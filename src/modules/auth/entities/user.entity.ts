import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryColumn('uuid')
  id!: string;

  // * Null for guests and OAuth-only accounts. Unique when present, so a Postgres partial-unique (many NULLs
  // * allowed) is the right shape — a user is identified by email only once they set one.
  @Index({ unique: true, where: 'email IS NOT NULL' })
  @Column({ type: 'varchar', nullable: true })
  email!: string | null;

  // * Argon2id hash. Null for guests and OAuth-only accounts — those authenticate without a password.
  @Column({ type: 'varchar', nullable: true })
  passwordHash!: string | null;

  // * Set when the user proves control of their email via the verification link. Null = unverified (the app decides
  // * which actions that gates); OAuth/guest accounts leave it null since they have no email/password flow.
  @Column({ type: 'timestamptz', nullable: true })
  emailVerifiedAt!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  displayName!: string | null;

  @Column({ type: 'boolean', default: true })
  isAnonymous!: boolean;

  // * Set by `admin:create` when an operator hands over an account with a temporary password: the holder must
  // * change it before anything else is allowed. Cleared on the first successful change.
  @Column({ type: 'boolean', default: false })
  mustChangePassword!: boolean;

  // * Suspension is an administrative state, distinct from deletion: the row stays, sessions are revoked, and
  // * authentication is refused until it is lifted.
  @Column({ type: 'timestamptz', nullable: true })
  suspendedAt!: Date | null;

  // ! Erasure is deferred, not immediate: the account stays usable during the grace window so the person can
  // ! change their mind, and only the scheduled job past that window deletes anything. Clearing this column is
  // ! all it takes to cancel.
  @Column({ type: 'timestamptz', nullable: true })
  deletionRequestedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
