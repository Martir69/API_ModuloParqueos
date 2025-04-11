const oracledb = require('oracledb'); 
const express = require('express');
const router = express.Router();
const { getConnection } = require('../database');

// Consultar disponibilidad de parqueo
router.get('/disponibilidad_parqueo', async (req, res) => {
  let connection;
  try {
    // Verificación de parámetros requeridos
    const { JOR_TIPO, SECCION } = req.query;
    if (!JOR_TIPO || !SECCION) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos: JOR_TIPO y SECCION' });
    }

    connection = await getConnection(); // Abriendo conexión a la base de datos

    const result = await connection.execute(
      `SELECT 
         PJ.JOR_JORNADA_ID, 
         PP.PAR_NUMERO_PARQUEO, 
         PJ.JOR_TIPO, 
         PJ.EJOR_ESTADO_ID, 
         PP.PAR_SECCION,
         PR.RES_ID_USUARIO,
         PR.RES_RESERVACION_ID
       FROM PAR_JORNADA PJ
       INNER JOIN PAR_PARQUEO PP ON PJ.PAR_PARQUEO_ID = PP.PAR_PARQUEO_ID
       LEFT JOIN PAR_RESERVACION PR ON (
         PJ.JOR_JORNADA_ID = PR.JOR_JORNADA_ID 
         AND PR.ERES_ESTADO_ID = 1 )
       WHERE PJ.JOR_TIPO = :JOR_TIPO AND PP.PAR_SECCION = :SECCION`,
      { JOR_TIPO, SECCION }
    );

    // Si no se encuentran resultados, devolver un mensaje adecuado
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No se encontraron parqueos disponibles en esta jornada y sección' });
    }

     // Mapeando resultados para devolver en formato JSON
     const mappedResults = result.rows.map(row => ({
      JOR_JORNADA_ID: row[0],
      PAR_NUMERO_PARQUEO: row[1],
      JOR_TIPO: row[2],
      EJOR_ESTADO_ID: row[3],
      PAR_SECCION: row[4],
      RES_ID_USUARIO: row[5],
      RES_RESERVACION_ID: row[6],
    }));

    // Enviando los resultados
    res.json(mappedResults); // Solo envía una respuesta

  } catch (error) {
    console.error('Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error interno en el servidor' });
    }
  } finally {
    if (connection) {
      await connection.close(); // Cerrar la conexión de base de datos
    }
  }
});

// Realizar reservaciones de parqueo estudiantes, administrativos
router.post('/insertar_parqueo', async (req, res) => {
  const schemaName = 'Desarrolladores';
  let connection;

  try {
    const { RES_ID_USUARIO, JOR_JORNADA_ID} = req.body;

    const camposRequeridos = {
      RES_ID_USUARIO: 'Usuario',
      JOR_JORNADA_ID: 'Jornada',
    };

    
    const camposFaltantes = Object.entries(camposRequeridos)
      .filter(([key]) => !req.body[key])
      .map(([, value]) => value);

    if (camposFaltantes.length > 0) {
      return res.status(400).json({
        error: `Campos requeridos faltantes: ${camposFaltantes.join(', ')}`
      });
    }
    connection = await getConnection();

    // Validar si la jornada existe y está disponible
    const jornada = await connection.execute(
      `SELECT EJOR_ESTADO_ID FROM ${schemaName}.PAR_JORNADA WHERE JOR_JORNADA_ID = :JOR_JORNADA_ID`,
      { JOR_JORNADA_ID }
    );

    if (jornada.rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'El número de parqueo seleccionado en la jornada no fue encontrado' });
    }

    if (jornada.rows[0][0] !== 1) {
      await connection.rollback();
      return res.status(409).json({ error: 'Jornada no disponible para el número de parqueo seleccionado o ya fue reservada' });
    }

    // Verificar conflictos
    const conflicto = await connection.execute(
      `SELECT 1 FROM ${schemaName}.PAR_RESERVACION 
      WHERE JOR_JORNADA_ID = :JOR_JORNADA_ID`,
      { JOR_JORNADA_ID}
    );

   
    // Insertar reservación
    const result = await connection.execute(
      `INSERT INTO ${schemaName}.PAR_RESERVACION (
        RES_ID_USUARIO, RES_FECHA_INICIO, RES_FECHA_FIN, 
        ERES_ESTADO_ID, RES_FECHA_CREACION, JOR_JORNADA_ID
      ) VALUES (
        :RES_ID_USUARIO, 
        SYSDATE, 
        LAST_DAY(ADD_MONTHS(TRUNC(SYSDATE, 'YEAR'), 5)), 
        1, 
        SYSDATE, 
        :JOR_JORNADA_ID
      ) RETURNING RES_RESERVACION_ID INTO :RES_ID`,
      {
        RES_ID_USUARIO,
        JOR_JORNADA_ID,
        RES_ID: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
      },
      { autoCommit: false }
    );

    const reservacionId = result.outBinds.RES_ID[0];

    // Actualizar estado de jornada
    const updateResult = await connection.execute(
      `UPDATE ${schemaName}.PAR_JORNADA 
       SET EJOR_ESTADO_ID = 2 
       WHERE JOR_JORNADA_ID = :JOR_JORNADA_ID 
       AND EJOR_ESTADO_ID = 1`,
      { JOR_JORNADA_ID },
      { autoCommit: false }
    );

    if (updateResult.rowsAffected === 0) {
      throw new Error('No se pudo actualizar la jornada. Puede que ya tenga otro estado.');
    }

    // Confirmar la transacción
    await connection.commit();

    res.status(201).json({
      success: true,
      message: 'Reservación creada',
      data: {
        id: reservacionId,
        fecha: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error en reservación:', error);

    if (connection) await connection.rollback();

    const response = {
      success: false,
      error: 'Error interno en el servidor'
    };

    if (process.env.NODE_ENV === 'development') {
      response.details = {
        message: error.message,
        oracleCode: error.errorNum || 'N/A',
        sql: error.sql || 'N/A'
      };
    }

    res.status(500).json(response);
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error('Error cerrando conexión:', err);
      }
    }
  }
});

// Realizar reservaciones de parqueo parqueo visitas (marquaje de entrada)
router.post('/insertar_entrada_visitas', async (req, res) => {
  const schemaName = 'Desarrolladores';
  let connection;

  try{
      const { RES_ID_USUARIO, JOR_JORNADA_ID} = req.body;
  
      const camposRequeridos = {
        RES_ID_USUARIO: 'Usuario',
        JOR_JORNADA_ID: 'Jornada',
      };
      const camposFaltantes = Object.entries(camposRequeridos)
      .filter(([key]) => !req.body[key])
      .map(([, value]) => value);

    if (camposFaltantes.length > 0) {
      return res.status(400).json({
        error: `Campos requeridos faltantes: ${camposFaltantes.join(', ')}`
      });
    }
    connection = await getConnection();

    // Validar si la jornada existe y está disponible
    const jornada = await connection.execute(
      `SELECT EJOR_ESTADO_ID FROM ${schemaName}.PAR_JORNADA WHERE JOR_JORNADA_ID = :JOR_JORNADA_ID`,
      { JOR_JORNADA_ID }
    );

    if (jornada.rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'El número de parqueo seleccionado en la jornada no fue encontrado' });
    }

    if (jornada.rows[0][0] !== 1) {
      await connection.rollback();
      return res.status(409).json({ error: 'Jornada no disponible para el número de parqueo seleccionado o ya fue reservada' });
    }

       // Insertar registro de entrada con RES_FECHA_ENTRADA (SYSDATE) y sin fecha de salida
     const result = await connection.execute(
      `INSERT INTO ${schemaName}.PAR_RESERVACION (
         RES_ID_USUARIO, RES_FECHA_INICIO, RES_FECHA_FIN, 
         ERES_ESTADO_ID, RES_FECHA_CREACION, JOR_JORNADA_ID
       ) VALUES (
         :RES_ID_USUARIO, 
         SYSDATE, 
         NULL, 
         1, 
         SYSDATE, 
         :JOR_JORNADA_ID
       ) RETURNING RES_RESERVACION_ID INTO :RES_ID`,
      {
        RES_ID_USUARIO,
        JOR_JORNADA_ID,
        RES_ID: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
      },
      { autoCommit: false }
    );
      
      const reservacionId = result.outBinds.RES_ID[0];

      // Actualizar estado de jornada
      const updateResult = await connection.execute(
        `UPDATE ${schemaName}.PAR_JORNADA 
         SET EJOR_ESTADO_ID = 2 
         WHERE JOR_JORNADA_ID = :JOR_JORNADA_ID 
         AND EJOR_ESTADO_ID = 1`,
        { JOR_JORNADA_ID },
        { autoCommit: false }
      );
  
      if (updateResult.rowsAffected === 0) {
        throw new Error('No se pudo actualizar la jornada. Puede que ya tenga otro estado.');
      }
  
      // Confirmar la transacción
      await connection.commit();
  
      res.status(201).json({
        success: true,
        message: 'Reservación creada',
        data: {
          id: reservacionId,
          fecha: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Error en reservación:', error);
  
      if (connection) await connection.rollback();
  
      const response = {
        success: false,
        error: 'Error interno en el servidor'
      };
  
      if (process.env.NODE_ENV === 'development') {
        response.details = {
          message: error.message,
          oracleCode: error.errorNum || 'N/A',
          sql: error.sql || 'N/A'
        };
      }
  
      res.status(500).json(response);
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch (err) {
          console.error('Error cerrando conexión:', err);
        }
      }
    }
  });

  // Liberacion de parqueo visitas (marquaje de salida)
  router.patch('/insertar_salida_visitas', async (req, res) => {
    const schemaName = 'Desarrolladores';
    let connection;
  
    try {
      const { RES_RESERVACION_ID } = req.body;
      const camposRequeridos = {
        RES_RESERVACION_ID: 'RES_RESERVACION_ID',
      };
  
      const camposFaltantes = Object.entries(camposRequeridos)
        .filter(([key]) => !req.body[key])
        .map(([, value]) => value);
  
      if (camposFaltantes.length > 0) {
        return res.status(400).json({
          error: `Campos requeridos faltantes: ${camposFaltantes.join(', ')}`
        });
      }
  
      connection = await getConnection();
  
      const reservacion = await connection.execute(
        `SELECT JOR_JORNADA_ID, ERES_ESTADO_ID 
         FROM ${schemaName}.PAR_RESERVACION 
         WHERE RES_RESERVACION_ID = :RES_RESERVACION_ID 
         FOR UPDATE`,
        { RES_RESERVACION_ID }
      );
  
      if (reservacion.rows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: 'Reservación no encontrada' });
      }
  
      const [JOR_JORNADA_ID, ERES_ESTADO_ID] = reservacion.rows[0];
      if (ERES_ESTADO_ID !== 1) {
        await connection.rollback();
        return res.status(400).json({ error: 'La reservación no se encuentra en estado abierto' });
      }
  
      const jornada = await connection.execute(
        `SELECT EJOR_ESTADO_ID 
         FROM ${schemaName}.PAR_JORNADA 
         WHERE JOR_JORNADA_ID = :JOR_JORNADA_ID 
         FOR UPDATE`,
        { JOR_JORNADA_ID }
      );
  
      if (jornada.rows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: 'La jornada asociada no fue encontrada' });
      }
  
      const updateReservacionResult = await connection.execute(
        `UPDATE ${schemaName}.PAR_RESERVACION 
         SET RES_FECHA_FIN = SYSDATE, ERES_ESTADO_ID = 3 
         WHERE RES_RESERVACION_ID = :RES_RESERVACION_ID 
         AND ERES_ESTADO_ID = 1`,
        { RES_RESERVACION_ID },
        { autoCommit: false }
      );
  
      if (updateReservacionResult.rowsAffected === 0) {
        throw new Error('No se encontró reservación abierta para actualizar la salida');
      }
  
      const updateResult = await connection.execute(
        `UPDATE ${schemaName}.PAR_JORNADA 
         SET EJOR_ESTADO_ID = 1 
         WHERE JOR_JORNADA_ID = :JOR_JORNADA_ID 
         AND EJOR_ESTADO_ID = 2`,
        { JOR_JORNADA_ID },
        { autoCommit: false }
      );
  
      if (updateResult.rowsAffected === 0) {
        throw new Error('No se pudo actualizar la jornada. Puede que ya tenga otro estado.');
      }
  
      const fechas = await connection.execute(
        `SELECT RES_FECHA_INICIO, RES_FECHA_FIN 
         FROM ${schemaName}.PAR_RESERVACION 
         WHERE RES_RESERVACION_ID = :RES_RESERVACION_ID`,
        { RES_RESERVACION_ID }
      );
  
      const [RES_FECHA_INICIO, RES_FECHA_FIN] = fechas.rows[0];
      const diferencia = RES_FECHA_FIN - RES_FECHA_INICIO;
      const horas = Math.floor(diferencia / 3600000);
      const minutos = Math.floor((diferencia % 3600000) / 60000);
      const segundos = Math.floor((diferencia % 60000) / 1000);
  
      const duracion = `${horas}h ${minutos}m ${segundos}s`;
  
      const usuario = await connection.execute(
        `SELECT RES_ID_USUARIO 
         FROM ${schemaName}.PAR_RESERVACION 
         WHERE RES_RESERVACION_ID = :RES_RESERVACION_ID`,
        { RES_RESERVACION_ID }
      );
  
      const RES_ID_USUARIO = usuario.rows[0][0];
  
      await connection.commit();
  
      return res.status(200).json({
        success: true,
        message: 'Salida registrada y parqueo liberado',
        RES_ID_USUARIO,
        TIEMPO_TOTAL: duracion
      });
    } catch (error) {
      console.error('Error en la actualización:', error);
  
      if (connection) await connection.rollback();
  
      const response = {
        success: false,
        error: 'Error interno en el servidor'
      };
  
      if (process.env.NODE_ENV === 'development') {
        response.details = {
          message: error.message,
          oracleCode: error.errorNum || 'N/A',
          sql: error.sql || 'N/A'
        };
      }
  
      return res.status(500).json(response);
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch (err) {
          console.error('Error cerrando conexión:', err);
        }
      }
    }
  });
  



  // Realizar cancelacion de parqueo estudiantes, administrativos
  router.patch('/cancelacion_parqueo', async (req, res) => {
    const schemaName = 'Desarrolladores';
    let connection;
  
    try {
      // Validar que el cuerpo de la solicitud contenga el ID de la reservación
      const { RES_RESERVACION_ID } = req.body;
  
      if (!RES_RESERVACION_ID) {
        return res.status(400).json({ error: 'RES_RESERVACION_ID es requerido' });
      }
  
      connection = await getConnection();
  
      // Bloquear la reservación para actualizarla de forma segura
      const reservacion = await connection.execute(
        `SELECT JOR_JORNADA_ID, ERES_ESTADO_ID 
         FROM ${schemaName}.PAR_RESERVACION 
         WHERE RES_RESERVACION_ID = :RES_RESERVACION_ID 
         FOR UPDATE`,
        { RES_RESERVACION_ID }
      );
  
      if (!reservacion.rows.length) {
        return res.status(404).json({ error: 'Reservación no encontrada' });
      }
  
      const [JOR_JORNADA_ID, ERES_ESTADO_ID] = reservacion.rows[0];
  
      if (ERES_ESTADO_ID !== 1) {
        return res.status(400).json({ error: 'La reservación no se puede cancelar porque ya fue cancelada anteriormente' });
      }
  
      // Actualizar la reservación
      const updateReservacionResult = await connection.execute(
        `UPDATE ${schemaName}.PAR_RESERVACION 
         SET ERES_ESTADO_ID = 2 
         WHERE RES_RESERVACION_ID = :RES_RESERVACION_ID 
         AND ERES_ESTADO_ID = 1`,
        { RES_RESERVACION_ID },
        { autoCommit: false }
      );
  
      if (updateReservacionResult.rowsAffected === 0) {
        throw new Error('No se encontró reservación abierta para cancelar');
      }
  
      // Liberar el parqueo
      const updateResult = await connection.execute(
        `UPDATE ${schemaName}.PAR_JORNADA 
         SET EJOR_ESTADO_ID = 1 
         WHERE JOR_JORNADA_ID = :JOR_JORNADA_ID 
         AND EJOR_ESTADO_ID = 2`,
        { JOR_JORNADA_ID },
        { autoCommit: false }
      );
  
      if (updateResult.rowsAffected === 0) {
        throw new Error('No se pudo actualizar la jornada. Puede que ya tenga otro estado.');
      }
  
      // Confirmar la transacción
      await connection.commit();
  
      res.status(200).json({
        success: true,
        message: 'Reservación cancelada y parqueo liberado',
      });
  
    } catch (error) {
      console.error('Error en la cancelación de parqueo:', error);
  
      if (connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error('Error realizando rollback:', rollbackError);
        }
      }
  
      const response = {
        success: false,
        error: 'Error interno en el servidor',
      };
  
      if (process.env.NODE_ENV === 'development') {
        response.details = {
          message: error.message,
          oracleCode: error.errorNum || 'N/A',
          sql: error.sql || 'N/A',
        };
      }
  
      res.status(500).json(response);
  
    } finally {
      if (connection) {
        try {
          await connection.close();
        } catch (closeError) {
          console.error('Error cerrando la conexión:', closeError);
        }
      }
    }
  });
  
module.exports = router;