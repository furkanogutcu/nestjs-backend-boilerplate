import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '@modules/auth/entities/user.entity';

@Entity('posts')
export class Post {
  @PrimaryColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  authorId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_id' })
  author!: User;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 140 })
  slug!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  // * Storage key, not a URL: the public origin can change without rewriting every row.
  @Column({ type: 'varchar', length: 255, nullable: true })
  coverImageKey!: string | null;

  // * Null means draft. A timestamp rather than a boolean so "when did this go live" needs no second column.
  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
