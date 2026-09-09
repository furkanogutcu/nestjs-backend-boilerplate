import { CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { User } from '../../entities/user.entity';
import { Role } from './role.entity';

@Entity('user_roles')
@Index(['roleId'])
export class UserRole {
  @PrimaryColumn('uuid')
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @PrimaryColumn('uuid')
  roleId!: string;

  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role!: Role;

  @CreateDateColumn({ type: 'timestamptz' })
  grantedAt!: Date;
}
