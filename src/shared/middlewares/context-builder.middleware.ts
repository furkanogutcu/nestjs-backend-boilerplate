import { NextFunction, Request, Response } from 'express';
import { DateTime } from 'luxon';

import { parseClientIp } from '../utils/ip.util';

export function contextBuilder(req: Request, _res: Response, next: NextFunction) {
  const ipAddress = parseClientIp({ req });

  req.context = {
    ipAddress,
    timestamp: DateTime.now().toMillis(),
  };

  next();
}
