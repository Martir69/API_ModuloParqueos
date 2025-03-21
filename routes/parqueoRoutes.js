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
      `SELECT PJ.JOR_JORNADA_ID, PP.PAR_NUMERO_PARQUEO, PJ.JOR_TIPO, PJ.EJOR_ESTADO_ID, PP.PAR_SECCION
       FROM PAR_JORNADA PJ
       INNER JOIN PAR_PARQUEO PP ON PJ.PAR_PARQUEO_ID = PP.PAR_PARQUEO_ID
       WHERE PJ.EJOR_ESTADO_ID = 1 AND PJ.JOR_TIPO = :JOR_TIPO AND PP.PAR_SECCION = :SECCION`,
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
      PAR_SECCION: row[4]
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

// Realizar reservaciones de parqueo parqueo estudiantes, administrativos
router.post('/insertar', async (req, res) => {
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

    if (conflicto.rows.length > 0) {
      await connection.rollback();
      return res.status(409).json({ error: 'Conflicto de horario detectado' });
    }

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
  
      // Bloquear la reservación para actualizarla de forma segura
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
  
         // Bloquear la jornada para evitar condiciones de carrera
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
  
      // Actualizar el registro de reservación para establecer la fecha de salida
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
  
      // Actualizar el estado de la jornada para marcar el parqueo como disponible
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
        message: 'Salida registrada y parqueo liberado',
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
  
module.exports = router;