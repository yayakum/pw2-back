require('dotenv').config();
const cors = require('cors');

// Configuración de CORS
const corsOptions = {
  origin: process.env.CORS_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400 // 24 horas (en segundos)
};

// Exportamos el middleware configurado
module.exports = cors(corsOptions);