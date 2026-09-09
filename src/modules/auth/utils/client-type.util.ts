import { Request } from 'express';

import { CLIENT_TYPE_HEADER } from '../constants/auth.constant';
import { ClientType } from '../enums/client-type.enum';

export function resolveClientType(request: Request): ClientType {
  const header = request.headers[CLIENT_TYPE_HEADER];
  const value = Array.isArray(header) ? header[0] : header;

  return value?.toLowerCase() === ClientType.Web ? ClientType.Web : ClientType.Mobile;
}
