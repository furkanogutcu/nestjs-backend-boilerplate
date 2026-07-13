import { userResponseSchema } from './user.response';

describe('userResponseSchema', () => {
  it('parses a user with linked providers', () => {
    const value = {
      id: '01923a45-b6c7-78d9-8a1b-2c3d4e5f6789',
      is_anonymous: false,
      display_name: 'Captain Nova',
      linked_providers: [{ provider: 'google', email: 'user@example.com' }],
    };

    expect(userResponseSchema.parse(value)).toEqual(value);
  });

  it('allows a null display name and a null provider email', () => {
    const value = {
      id: '01923a45-b6c7-78d9-8a1b-2c3d4e5f6789',
      is_anonymous: true,
      display_name: null,
      linked_providers: [{ provider: 'apple', email: null }],
    };

    expect(userResponseSchema.parse(value)).toEqual(value);
  });
});
