import { NextFunction, Request, Response } from 'express';
import { DateTime } from 'luxon';

import { parseClientIp } from '../utils/ip.util';

// eslint-disable-next-line no-restricted-syntax -- Express middleware signature is fixed (req, res, next)
export function contextBuilder(req: Request, _res: Response, next: NextFunction) {
  const ipAddress = parseClientIp({ req });

  req.context = {
    ipAddress,
    timestamp: DateTime.now().toMillis(),
  };

  next();
}
