const { close, migrate } = require('../db');

migrate()
  .then(() => console.log('PostgreSQL schema ready.'))
  .catch((error) => { console.error('Could not migrate PostgreSQL:', error.message); process.exitCode = 1; })
  .finally(close);