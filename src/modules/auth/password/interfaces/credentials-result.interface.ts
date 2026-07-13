import { User } from '../../entities/user.entity';
import { ITokenPair } from '../../interfaces/token-pair.interface';

export interface ICredentialsResult extends ITokenPair {
  user: User;
}
