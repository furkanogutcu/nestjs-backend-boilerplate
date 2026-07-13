import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';

function snakeCase(input: string): string {
  return input
    .replace(/([A-Z])([A-Z])([a-z])/g, '$1_$2$3')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  // eslint-disable-next-line no-restricted-syntax -- signature fixed by TypeORM's NamingStrategyInterface
  tableName(className: string, customName: string | undefined): string {
    return customName || snakeCase(className);
  }

  // eslint-disable-next-line no-restricted-syntax -- signature fixed by TypeORM's NamingStrategyInterface
  columnName(propertyName: string, customName: string | undefined, embeddedPrefixes: string[]): string {
    return snakeCase(embeddedPrefixes.concat(customName || propertyName).join('_'));
  }

  relationName(propertyName: string): string {
    return snakeCase(propertyName);
  }

  // eslint-disable-next-line no-restricted-syntax -- signature fixed by TypeORM's NamingStrategyInterface
  joinColumnName(relationName: string, referencedColumnName: string): string {
    return snakeCase(`${relationName}_${referencedColumnName}`);
  }

  // eslint-disable-next-line no-restricted-syntax -- signature fixed by TypeORM's NamingStrategyInterface
  joinTableName(firstTableName: string, secondTableName: string, firstPropertyName: string): string {
    return snakeCase(`${firstTableName}_${firstPropertyName.replace(/\./g, '_')}_${secondTableName}`);
  }

  // eslint-disable-next-line no-restricted-syntax -- signature fixed by TypeORM's NamingStrategyInterface
  joinTableColumnName(tableName: string, propertyName: string, columnName?: string): string {
    return snakeCase(`${tableName}_${columnName || propertyName}`);
  }
}
