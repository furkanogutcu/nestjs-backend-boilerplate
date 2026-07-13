import { User } from '../entities/user.entity';
import { ITokenPair } from './token-pair.interface';

export interface IGuestSession extends ITokenPair {
  user: User;
}
