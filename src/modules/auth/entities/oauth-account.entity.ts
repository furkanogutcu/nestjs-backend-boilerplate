import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Unique } from 'typeorm';

import { OAuthProvider } from '../enums/oauth-provider.enum';
import { User } from './user.entity';

@Entity('oauth_accounts')
@Unique(['provider', 'providerUserId'])
@Unique(['userId', 'provider'])
export class OAuthAccount {
  @PrimaryColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'varchar' })
  provider!: OAuthProvider;

  @Column({ type: 'varchar' })
  providerUserId!: string;

  // * Encrypted at rest with a ROW-BOUND AAD by OAuthAccountSubscriber (not a column transformer), so a ciphertext
  // * relocated to another row cannot be decrypted. Plain varchar here; the subscriber owns encrypt/decrypt.
  @Column({ type: 'varchar', nullable: true })
  email!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
