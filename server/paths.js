// Caminhos compartilhados entre módulos do servidor.
//
// DATA_DIR: volume persistente (produção, via env DATA_DIR=/data) ou server/data em dev.
// O banco SQLite mora aqui.
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');

const DB_FILE = path.join(DATA_DIR, 'submissoes.db');

module.exports = { DATA_DIR, DB_FILE };
