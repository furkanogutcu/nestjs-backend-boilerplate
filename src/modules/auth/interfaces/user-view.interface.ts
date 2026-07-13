import { OAuthProvider } from '../enums/oauth-provider.enum';

export interface IUserView {
  id: string;
  isAnonymous: boolean;
  displayName: string | null;
  linkedProviders: { provider: OAuthProvider; email: string | null }[];
}
