const DIRECTIVE = /^\s*(eslint|ts-|prettier-|globals|exported|jshint|istanbul|v8|c8|#|@ts-)/;

const PREFIXED = /^\s*(\*|!|\?|TODO:)/;

const DEFAULTS = { maxBlockLines: 1, maxLength: 120 };

function isDirective(comment) {
  return comment.type === 'Line' && DIRECTIVE.test(comment.value);
}

function isJsDoc(comment) {
  return comment.type === 'Block' && comment.value.startsWith('*');
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Comments are a last resort: each carries a Better Comments prefix, stands alone on one line, and stays short.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          maxBlockLines: { type: 'integer', minimum: 1 },
          maxLength: { type: 'integer', minimum: 40 },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missingPrefix:
        'Comment must start with a Better Comments prefix: "// *", "// !", "// ?" or "// TODO:". Commented-out code is deleted, not left behind.',
      blockTooLong:
        'Comment block is {{actual}} lines; the limit is {{max}}. Say the one thing the code cannot say, or delete it.',
      tooLong: 'Comment line is {{actual}} characters; the limit is {{max}}. Shorten it or delete it.',
      blockComment: 'Use "// *"-style line comments. A /* */ block is only allowed as a JSDoc "/** */" API contract.',
    },
  },
  create(context) {
    const options = { ...DEFAULTS, ...(context.options[0] ?? {}) };
    const source = context.sourceCode ?? context.getSourceCode();

    function isOwnLine(comment) {
      return source.lines[comment.loc.start.line - 1].slice(0, comment.loc.start.column).trim() === '';
    }

    function checkLength(comment) {
      const length = source.lines[comment.loc.start.line - 1].length;

      if (length > options.maxLength) {
        context.report({
          loc: comment.loc,
          messageId: 'tooLong',
          data: { actual: String(length), max: String(options.maxLength) },
        });
      }
    }

    return {
      Program() {
        const comments = source.getAllComments();
        let run = [];

        function flushRun() {
          if (run.length > options.maxBlockLines) {
            context.report({
              loc: { start: run[0].loc.start, end: run[run.length - 1].loc.end },
              messageId: 'blockTooLong',
              data: { actual: String(run.length), max: String(options.maxBlockLines) },
            });
          }
          run = [];
        }

        for (const comment of comments) {
          if (comment.type === 'Block') {
            flushRun();

            if (!isJsDoc(comment)) {
              context.report({ loc: comment.loc, messageId: 'blockComment' });
            }
            continue;
          }

          if (isDirective(comment)) {
            flushRun();
            continue;
          }

          if (!PREFIXED.test(comment.value)) {
            context.report({ loc: comment.loc, messageId: 'missingPrefix' });
          }

          checkLength(comment);

          // * A trailing comment labels the code it sits on, so it never joins an own-line block.
          if (!isOwnLine(comment)) {
            flushRun();
            continue;
          }

          const previous = run[run.length - 1];

          if (previous && comment.loc.start.line !== previous.loc.start.line + 1) {
            flushRun();
          }

          run.push(comment);
        }

        flushRun();
      },
    };
  },
};

export default rule;
