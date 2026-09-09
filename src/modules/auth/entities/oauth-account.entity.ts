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

  // ! Encrypted by OAuthAccountSubscriber under a row-bound AAD — do not add a column transformer here.
  @Column({ type: 'varchar', nullable: true })
  email!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
