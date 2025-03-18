const oracledb = require('oracledb');

async function initialize() {
  try {
    await oracledb.createPool({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      connectString: process.env.DB_CONNECTION,
      poolMax: 10, // Más conexiones permitidas en el pool
      poolMin: 2,
      poolIncrement: 2,
      poolTimeout: 60,
    });
    console.log('Pool de conexiones a Oracle inicializado');
  } catch (err) {
    console.error('Error inicializando el pool de conexiones:', err);
    throw err;
  }
}

async function getConnection() {
  try {
    return await oracledb.getConnection();
  } catch (err) {
    console.error('Error obteniendo conexión:', err);
    throw err;
  }
}

async function closePool() {
  try {
    await oracledb.getPool().close();
    console.log('Pool de conexiones cerrado');
  } catch (err) {
    console.error('Error cerrando el pool de conexiones:', err);
  }
}

module.exports = { initialize, getConnection, closePool };
