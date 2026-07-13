import 'reflect-metadata';

import { Settings } from 'luxon';

// * Mirror main.ts so timestamp-producing logic is deterministic regardless of machine timezone.
Settings.defaultZone = 'utc';
