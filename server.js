require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initialize, closePool } = require('./database');
const app = express();
const PORT = process.env.PORT; // Siempre tomarlo del .env


// Configurar CORS antes de las rutas
app.use(cors({
  origin: 'http://localhost:5173', // URL de tu frontend Vite
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));



// Middleware para manejar JSON mal formado
app.use(express.json(), (err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.error('❌ Error de JSON mal formado:', err.message);
    return res.status(400).json({ success: false, error: 'JSON mal formado' });
  }
  next();
});



// Validación de variables de entorno
if (!PORT) {
  console.error('Error: La variable de entorno PORT no está definida.');
  process.exit(1);
}

if (!process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_CONNECTION) {
  console.error('Error: Variables de entorno de base de datos no están definidas.');
  process.exit(1);
}

app.use(express.json());

const parqueoRoutes = require('./routes/parqueoRoutes');
app.use('/api', parqueoRoutes);

// Inicializar el pool de conexiones y arrancar el servidor
initialize()
  .then(() => {
    app.listen(PORT, 'localhost', () => {
      console.log(`Servidor corriendo en http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('No se pudo iniciar el servidor:', err);
    process.exit(1);
  });

// Manejar la señal SIGINT para cerrar el pool de conexiones de manera ordenada
process.on('SIGINT', async () => {
  try {
    await closePool();
    console.log('Servidor cerrado.');
    process.exit(0);
  } catch (err) {
    console.error('Error cerrando el pool de conexiones:', err);
    process.exit(1);
  }
});

// Ruta de prueba para verificar que el servidor está funcionando
app.get('/', (req, res) => {
  res.send('Servidor funcionando correctamente');
});
