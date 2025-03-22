const oracledb = require('oracledb');

// Inicializa el pool de conexiones a Oracle
async function initialize() {
  try {
    await oracledb.createPool({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      connectString: process.env.DB_CONNECTION,
      poolMax: 10, // Máximo número de conexiones en el pool
      poolMin: 2,  // Mínimo número de conexiones en el pool
      poolIncrement: 2, // Incremento de conexiones cuando el pool está agotado
      poolTimeout: 60, // Tiempo de espera en segundos antes de cerrar conexiones inactivas
    });
    console.log('Pool de conexiones a Oracle inicializado');
  } catch (err) {
    console.error('Error inicializando el pool de conexiones:', err);
    throw err;
  }
}

// Obtiene una conexión del pool
async function getConnection() {
  try {
    return await oracledb.getConnection();
  } catch (err) {
    console.error('Error obteniendo conexión:', err);
    throw err;
  }
}

// Cierra el pool de conexiones
async function closePool() {
  try {
    await oracledb.getPool().close();
    console.log('Pool de conexiones cerrado');
  } catch (err) {
    console.error('Error cerrando el pool de conexiones:', err);
  }
}

module.exports = { initialize, getConnection, closePool };