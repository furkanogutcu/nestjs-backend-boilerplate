import { HttpStatus } from '@nestjs/common';
import { EntityNotFoundError, QueryFailedError, TypeORMError } from 'typeorm';

import { AppConflictException } from '../conflict.exception';
import { ExceptionCode } from '../enums/exception-code.enum';
import { AppNotFoundException } from '../not-found.exception';
import { AppUnprocessableEntityException } from '../unprocessable-entity.exception';
import { TypeORMExceptionTransformer } from './typeorm.exception-transformer';

function queryFailed(driver: { code?: string; detail?: string }): QueryFailedError {
  const driverError = Object.assign(new Error('query failed'), driver);

  return new QueryFailedError('SELECT 1', [], driverError);
}

describe('TypeORMExceptionTransformer', () => {
  describe('EntityNotFoundError', () => {
    it('maps to a generic AppNotFoundException without leaking the entity class name', () => {
      const result = TypeORMExceptionTransformer.transform(new EntityNotFoundError('User', {}));

      expect(result).toBeInstanceOf(AppNotFoundException);
      expect((result as AppNotFoundException).resourceName).toBe('Resource');
      expect(result?.httpCode).toBe(HttpStatus.NOT_FOUND);
      expect(JSON.stringify(result)).not.toContain('User');
    });
  });

  describe('QueryFailedError', () => {
    it('maps unique-violation (23505) to a generic AppConflictException', () => {
      const result = TypeORMExceptionTransformer.transform(
        queryFailed({ code: '23505', detail: 'Key (email)=(a@b.com) already exists.' }),
      );

      expect(result).toBeInstanceOf(AppConflictException);
      expect((result as AppConflictException).conflictedFields).toEqual([]);
      expect(result?.code).toBe(ExceptionCode.SomeFieldsAlreadyExists);
      expect(result?.httpCode).toBe(HttpStatus.CONFLICT);
    });

    it('does not leak the conflicting column names or values from the driver detail', () => {
      const result = TypeORMExceptionTransformer.transform(
        queryFailed({ code: '23505', detail: 'Key (tenant_id, email)=(1, a@b.com) already exists.' }),
      );

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('tenant_id');
      expect(serialized).not.toContain('email');
      expect(serialized).not.toContain('a@b.com');
    });

    it('maps a 23505 with no detail to a generic conflict rather than falling through to 500', () => {
      const result = TypeORMExceptionTransformer.transform(queryFailed({ code: '23505' }));

      expect(result).toBeInstanceOf(AppConflictException);
      expect((result as AppConflictException).conflictedFields).toEqual([]);
    });

    it('maps numeric overflow (22003) to AppUnprocessableEntityException', () => {
      const result = TypeORMExceptionTransformer.transform(queryFailed({ code: '22003' }));

      expect(result).toBeInstanceOf(AppUnprocessableEntityException);
      expect(result?.message).toBe('Numeric field is outside the allowed range');
    });

    it('returns undefined for an unmapped postgres error code', () => {
      expect(TypeORMExceptionTransformer.transform(queryFailed({ code: '99999' }))).toBeUndefined();
    });

    it('returns undefined when the driver error has no code', () => {
      expect(TypeORMExceptionTransformer.transform(queryFailed({}))).toBeUndefined();
    });
  });

  it('returns undefined for a generic TypeORMError', () => {
    expect(TypeORMExceptionTransformer.transform(new TypeORMError('something else'))).toBeUndefined();
  });
});
