// Usamos los imports de ES Modules que ya tenías
import express from 'express'
import morgan from 'morgan'
import cors from 'cors'
import dotenv from 'dotenv'
import { Sequelize, DataTypes } from 'sequelize' // Agregamos DataTypes para definir el modelo
import serverless from 'serverless-http'

// Cargar variables de entorno
dotenv.config()
const { PORT_DB, USER_DB, PASS_DB, NAME_DB } = process.env

// --- CAMBIO CLAVE 1: GESTIÓN DE LA CONEXIÓN A LA BD ---
// Instanciamos Sequelize en el scope global del módulo.
const DATA_BASE = new Sequelize(
  `postgres://${USER_DB}:${PASS_DB}@${PORT_DB}/${NAME_DB}`,
  {
    logging: false,
    dialect: 'postgres',
    pool: {
      max: 2,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  }
)

// --- NUEVO: DEFINICIÓN DEL MODELO USER ---
const User = DATA_BASE.define(
  'User',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true
      }
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
        notEmpty: true
      }
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true
      }
    }
  },
  {
    tableName: 'users',
    timestamps: true // Esto agrega createdAt y updatedAt automáticamente
  }
)

// Función para conectar y sincronizar la base de datos
const connectToDatabase = async () => {
  try {
    await DATA_BASE.authenticate()
    console.log('Connection has been established successfully.')

    // Sincronizar el modelo (crear la tabla si no existe)
    // En producción, es mejor usar migraciones
    await DATA_BASE.sync({ alter: true }) // alter: true actualiza la tabla sin borrar datos
    console.log('Database synchronized successfully.')
  } catch (error) {
    console.error('Unable to connect to the database:', error)
  }
}

const app = express()
const router = express.Router()

// Middlewares - Configuración específica para Netlify
app.use(morgan('dev'))

// Middleware personalizado para manejar el body de Netlify
app.use('/api', (req, res, next) => {
  console.log('Middleware - Method:', req.method)
  console.log('Middleware - Content-Type:', req.get('Content-Type'))
  console.log('Middleware - Raw body type:', typeof req.body)
  console.log('Middleware - Raw body:', req.body)

  // Solo procesar el body en métodos que lo requieren
  const methodsWithBody = ['POST', 'PUT', 'PATCH']

  if (methodsWithBody.includes(req.method) && Buffer.isBuffer(req.body)) {
    try {
      const bodyString = req.body.toString('utf8')
      console.log('Body como string:', bodyString)

      // Solo parsear si hay contenido
      if (bodyString.trim()) {
        req.body = JSON.parse(bodyString)
        console.log('Body parseado exitosamente:', req.body)
      } else {
        req.body = {}
      }
    } catch (error) {
      console.error('Error parseando body:', error)
      return res.status(400).json({
        error: 'Formato de datos inválido',
        details: 'No se pudo parsear el JSON'
      })
    }
  } else if (methodsWithBody.includes(req.method) && !req.body) {
    // Para métodos con body pero sin contenido
    req.body = {}
  }

  next()
})

// Middleware para parsear JSON (después del middleware personalizado)
app.use(
  express.json({
    limit: '50mb',
    type: ['application/json', 'text/plain']
  })
)

// Middleware para parsear form data
app.use(
  express.urlencoded({
    extended: true,
    limit: '50mb'
  })
)

const corsOptions = {
  origin: '*',
  credentials: true,
  allowedHeaders: ['Content-Type', 'Origin', 'Accept', 'X-Requested-With'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
}
app.use(cors(corsOptions))

// --- RUTAS EXISTENTES ---
router.get('/saludo', (req, res) => {
  res.json({ message: '¡Hola desde mi API de Express en Netlify con BD!' })
})

// --- NUEVAS RUTAS PARA USUARIOS ---

// POST /api/newUser - Crear un nuevo usuario
router.post('/newUser', async (req, res) => {
  try {
    console.log('=== DEBUG POST /newUser ===')
    console.log('Content-Type:', req.get('Content-Type'))
    console.log('Body type:', typeof req.body)
    console.log('Body:', req.body)

    const { name, email, phone } = req.body

    // Validar que todos los campos estén presentes
    if (!name || !email || !phone) {
      return res.status(400).json({
        error: 'Todos los campos son requeridos: name, email, phone',
        received: { name, email, phone },
        bodyType: typeof req.body
      })
    }

    // Crear el usuario
    const newUser = await User.create({
      name,
      email,
      phone
    })

    res.status(201).json({
      message: 'Usuario creado exitosamente',
      user: newUser
    })
  } catch (error) {
    console.error('Error al crear usuario:', error)

    // Manejar error de email duplicado
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        error: 'El email ya está registrado'
      })
    }

    // Manejar errores de validación
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({
        error: 'Datos de entrada inválidos',
        details: error.errors.map((err) => err.message)
      })
    }

    res.status(500).json({
      error: 'Error interno del servidor al crear el usuario'
    })
  }
})

// GET /api/allUsers - Obtener todos los usuarios
router.get('/allUsers', async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: ['id', 'name', 'email', 'phone', 'createdAt', 'updatedAt'],
      order: [['createdAt', 'DESC']] // Ordenar por fecha de creación, más recientes primero
    })

    res.json({
      message: 'Usuarios obtenidos exitosamente',
      count: users.length,
      users
    })
  } catch (error) {
    console.error('Error al obtener usuarios:', error)
    res.status(500).json({
      error: 'Error interno del servidor al obtener los usuarios'
    })
  }
})

// --- MONTAJE DEL ROUTER ---
app.use('/api/', router)

// Middleware de errores
app.use((err, req, res, next) => {
  const status = err.status || 500
  const message = err.message || err
  console.error('Error middleware: ', message)
  res.status(status).send({ error: message })
})

// Conectar a la base de datos antes de exportar
connectToDatabase()

// Configuración específica para Netlify Functions
const netlifyHandler = serverless(app, {
  binary: false // Importante: forzar que no trate el JSON como binario
})

// Wrapper para manejar el parsing del body en Netlify
export const handler = async (event, context) => {
  // Debug: ver qué llega desde Netlify
  console.log('Netlify event body:', event.body)
  console.log('Netlify event isBase64Encoded:', event.isBase64Encoded)

  // Si el body viene como string, asegurarse de que esté bien formateado
  if (event.body && typeof event.body === 'string') {
    try {
      // Verificar si es JSON válido
      JSON.parse(event.body)
    } catch (e) {
      console.log('Body no es JSON válido:', event.body)
    }
  }

  return netlifyHandler(event, context)
}
