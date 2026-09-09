import pluralize from 'pluralize';

function lastWord(tableName) {
  const words = tableName.split('_');
  return words[words.length - 1];
}

function suggest(tableName) {
  const words = tableName.split('_');
  words[words.length - 1] = pluralize.plural(words[words.length - 1]);
  return words.join('_');
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'DB table names declared via @Entity must be plural snake_case.',
    },
    schema: [],
    messages: {
      notPlural: "Table name '{{name}}' must be plural — last word '{{word}}' is singular. Use '{{suggestion}}'.",
    },
  },
  create(context) {
    function check({ node, value }) {
      const word = lastWord(value);
      if (!pluralize.isPlural(word)) {
        context.report({
          node,
          messageId: 'notPlural',
          data: { name: value, word, suggestion: suggest(value) },
        });
      }
    }

    return {
      'CallExpression[callee.name="Entity"]'(node) {
        const arg = node.arguments[0];
        if (!arg) return;
        if (arg.type === 'Literal' && typeof arg.value === 'string') {
          check({ node: arg, value: arg.value });
          return;
        }
        if (arg.type === 'ObjectExpression') {
          const nameProp = arg.properties.find(
            (p) => p.type === 'Property' && p.key && (p.key.name === 'name' || p.key.value === 'name'),
          );
          if (nameProp && nameProp.value.type === 'Literal' && typeof nameProp.value.value === 'string') {
            check({ node: nameProp.value, value: nameProp.value.value });
          }
        }
      },
    };
  },
};

export default rule;
