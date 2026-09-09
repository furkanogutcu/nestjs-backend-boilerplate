import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('feature_flags')
export class FeatureFlag {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  key!: string;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description!: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
