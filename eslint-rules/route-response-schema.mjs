const HTTP_METHOD_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete']);
const RESPONSE_SCHEMA_DECORATOR = 'ResponseDto';

function decoratorName(decorator) {
  const expression = decorator.expression;

  if (expression.type === 'CallExpression') return expression.callee.name;
  if (expression.type === 'Identifier') return expression.name;

  return undefined;
}

function decoratorNamed({ node, name }) {
  return (node.decorators ?? []).find((decorator) => decoratorName(decorator) === name);
}

// * A route typed Promise<void> (or void) sends no body, so ResponseInterceptor has nothing to validate.
function returnsNothing(returnType) {
  if (!returnType) return false;

  const annotation = returnType.typeAnnotation;

  if (annotation.type === 'TSVoidKeyword') return true;
  if (annotation.type !== 'TSTypeReference' || annotation.typeName?.name !== 'Promise') return false;

  const args = annotation.typeArguments ?? annotation.typeParameters;

  return args?.params?.[0]?.type === 'TSVoidKeyword';
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Routes that return a body must declare their response schema with @ResponseDto.',
    },
    schema: [],
    messages: {
      missing:
        "Route '{{name}}' returns a body but has no @ResponseDto — ResponseInterceptor will throw and the endpoint will always answer 500. Add @ResponseDto({ schema }) or return Promise<void>.",
    },
  },
  create(context) {
    return {
      MethodDefinition(node) {
        const httpDecorator = (node.decorators ?? []).find((decorator) =>
          HTTP_METHOD_DECORATORS.has(decoratorName(decorator)),
        );

        if (!httpDecorator) return;
        if (returnsNothing(node.value.returnType)) return;
        if (decoratorNamed({ node, name: RESPONSE_SCHEMA_DECORATOR })) return;

        const classNode = node.parent?.parent;

        if (
          classNode?.type === 'ClassDeclaration' &&
          decoratorNamed({ node: classNode, name: RESPONSE_SCHEMA_DECORATOR })
        ) {
          return;
        }

        context.report({
          node: httpDecorator,
          messageId: 'missing',
          data: { name: node.key.name ?? '<anonymous>' },
        });
      },
    };
  },
};

export default rule;
