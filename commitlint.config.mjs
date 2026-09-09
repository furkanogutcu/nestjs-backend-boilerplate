// ! Enforces the commit rules in CONTRIBUTING.md; a documented rule nothing checks holds only by memory.

const ALLOWED_FOOTER_TOKENS = new Set(['breaking change', 'breaking-change', 'refs']);

// ! The SPACE after the colon is required, or a line such as `https://…` reads as a trailer.
const TRAILER_LINE = /^([A-Za-z][A-Za-z -]*?)\s*:\s/;

const footerTrailersAllowlist = ({ footer }) => {
  const offenders = (footer ?? '')
    .split('\n')
    .map((line) => TRAILER_LINE.exec(line)?.[1])
    .filter((token) => token !== undefined && !ALLOWED_FOOTER_TOKENS.has(token.toLowerCase()));

  return [
    offenders.length === 0,
    `commit message must not carry trailers (found: ${offenders.join(', ')}) — only BREAKING CHANGE and Refs are allowed`,
  ];
};

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [{ rules: { 'footer-trailers-allowlist': footerTrailersAllowlist } }],
  rules: {
    'body-empty': [2, 'always'],
    'footer-trailers-allowlist': [2, 'always'],
  },
};
