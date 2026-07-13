import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { Session } from '../entities/session.entity';

@Injectable()
export class SessionsRepository extends Repository<Session> {
  constructor(dataSource: DataSource) {
    super(Session, dataSource.createEntityManager());
  }
}
