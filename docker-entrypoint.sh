#!/bin/sh
set -e

echo "Running migrations..."
node ./node_modules/typeorm/cli.js migration:run -d dist/database/typeorm.data-source.js

echo "Starting application..."
exec "$@"
