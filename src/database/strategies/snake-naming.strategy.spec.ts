import { SnakeNamingStrategy } from './snake-naming.strategy';

describe('SnakeNamingStrategy', () => {
  const strategy = new SnakeNamingStrategy();

  describe('tableName', () => {
    it('snake-cases the class name', () => {
      expect(strategy.tableName('UserProfile', undefined)).toBe('user_profile');
    });

    it('prefers a custom name when provided', () => {
      expect(strategy.tableName('UserProfile', 'accounts')).toBe('accounts');
    });
  });

  describe('columnName', () => {
    it('snake-cases the property name', () => {
      expect(strategy.columnName('firstName', undefined, [])).toBe('first_name');
    });

    it('prefers a custom name when provided', () => {
      expect(strategy.columnName('firstName', 'given_name', [])).toBe('given_name');
    });

    it('applies embedded prefixes', () => {
      expect(strategy.columnName('city', undefined, ['address'])).toBe('address_city');
    });
  });

  it('snake-cases relation names', () => {
    expect(strategy.relationName('orderItems')).toBe('order_items');
  });

  it('builds join column names', () => {
    expect(strategy.joinColumnName('order', 'id')).toBe('order_id');
  });

  it('builds join table names', () => {
    expect(strategy.joinTableName('user', 'role', 'roles')).toBe('user_roles_role');
  });

  it('builds join table column names', () => {
    expect(strategy.joinTableColumnName('user', 'profileId', 'id')).toBe('user_id');
  });

  it('falls back to the property name when no column name is given', () => {
    expect(strategy.joinTableColumnName('user', 'profileId', undefined)).toBe('user_profile_id');
  });
});
