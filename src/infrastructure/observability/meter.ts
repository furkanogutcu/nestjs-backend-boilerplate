import type { Meter } from '@opentelemetry/api';
import { metrics } from '@opentelemetry/api';

import { appConfig } from '@config/app.config';

export function getMeter(): Meter {
  return metrics.getMeter(appConfig.slug);
}
