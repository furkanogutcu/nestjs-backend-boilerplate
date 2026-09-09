// ! The lock token is a plaintext prefix (`<token>|<ciphertext>`) so these guards check ownership without decrypting.

export const IDEMPOTENCY_RELEASE_IF_OWNED_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local sep = string.find(current, '|', 1, true)
if not sep then return 0 end
if string.sub(current, 1, sep - 1) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export const IDEMPOTENCY_STORE_IF_OWNED_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local sep = string.find(current, '|', 1, true)
if not sep then return 0 end
if string.sub(current, 1, sep - 1) == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  return 1
end
return 0
`;
