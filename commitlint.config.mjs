// ! These rules are written in CONTRIBUTING.md "Commit rules"; this file is what ENFORCES them. Documenting a
// ! rule that nothing checks means it holds only for as long as everyone remembers it.
//
// * `body-empty`: development commits are a single subject line. A footer is not a body, so `BREAKING CHANGE:`
// * still passes and version derivation is unaffected.
//
// * `footer-trailers-allowlist`: closing the body left the footer as the one remaining way in — trailers such as
// * `Co-Authored-By:` or `Signed-off-by:` land there and slip past `body-empty`. This locks footer tokens to an
// * allowlist: the two that carry meaning (the version signal and a task reference) pass, every other trailer is
// * rejected.
//
// * The squash-merge commit is produced on the GitHub side and the `commit-msg` hook never sees it, so the
// * "structured body" exception in CONTRIBUTING.md is unaffected by these rules.

const ALLOWED_FOOTER_TOKENS = new Set(['breaking change', 'breaking-change', 'refs']);

// ! The token of a `Token: value` line. The SPACE after the colon is required: without it a line such as
// ! `https://…` would also be read as a trailer.
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
