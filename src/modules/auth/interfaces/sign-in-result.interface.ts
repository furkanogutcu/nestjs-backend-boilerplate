import { ITokenPair } from './token-pair.interface';
import { IUserView } from './user-view.interface';

export interface ISignInResult extends ITokenPair {
  user: IUserView;
}
