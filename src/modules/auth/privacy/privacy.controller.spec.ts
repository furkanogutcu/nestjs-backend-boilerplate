import { createMock, DeepMocked } from '@golevelup/ts-vitest';

import { PrivacyController } from './privacy.controller';
import { AccountDeletionService } from './services/account-deletion.service';
import { DataExportService } from './services/data-export.service';

const user = { id: 'u1' };
const REQUESTED = new Date('2026-01-01T00:00:00.000Z');
const SCHEDULED = new Date('2026-01-31T00:00:00.000Z');

describe('PrivacyController', () => {
  let accountDeletionService: DeepMocked<AccountDeletionService>;
  let dataExportService: DeepMocked<DataExportService>;
  let controller: PrivacyController;

  beforeEach(() => {
    accountDeletionService = createMock<AccountDeletionService>();
    dataExportService = createMock<DataExportService>();
    controller = new PrivacyController(accountDeletionService, dataExportService);
  });

  it('maps a pending deletion to ISO timestamps', async () => {
    accountDeletionService.status.mockResolvedValue({ requestedAt: REQUESTED, scheduledFor: SCHEDULED });

    await expect(controller.status(user)).resolves.toEqual({
      requested_at: REQUESTED.toISOString(),
      scheduled_for: SCHEDULED.toISOString(),
    });
  });

  it('maps an absent deletion to nulls', async () => {
    accountDeletionService.status.mockResolvedValue({ requestedAt: null, scheduledFor: null });

    await expect(controller.status(user)).resolves.toEqual({ requested_at: null, scheduled_for: null });
  });

  it('requests deletion for the authenticated account', async () => {
    accountDeletionService.request.mockResolvedValue({ requestedAt: REQUESTED, scheduledFor: SCHEDULED });

    await controller.requestDeletion(user);

    expect(accountDeletionService.request).toHaveBeenCalledWith({ userId: 'u1' });
  });

  it('withdraws a deletion request', async () => {
    await controller.cancelDeletion(user);

    expect(accountDeletionService.cancel).toHaveBeenCalledWith({ userId: 'u1' });
  });

  it('exports the authenticated account', async () => {
    await controller.exportData(user);

    expect(dataExportService.export).toHaveBeenCalledWith({ userId: 'u1' });
  });
});
