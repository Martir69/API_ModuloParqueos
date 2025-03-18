require('dotenv').config();
const express = require('express');
const { initialize, closePool } = require('./database');

const app = express();

//Mandamos a llamar el archivo parqueoRoutes 
const parqueoRoutes = require('./routes/parqueoRoutes'); 


const PORT = process.env.PORT || 3000;

app.use(express.json());
//hacemos uso de la definicion que hicimos arriba
app.use('/api', parqueoRoutes);

// Inicializar la conexión a Oracle antes de iniciar el servidor
initialize()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor corriendo en http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('No se pudo iniciar el servidor:', err);
    process.exit(1);
  });

// Cerrar el pool de conexiones cuando se detenga el servidor
process.on('SIGINT', async () => {
  await closePool();
  console.log('Servidor cerrado.');
  process.exit(0);
});

// Rutas de prueba
app.get('/', (req, res) => {
  res.send('Servidor funcionando correctamente');
});
