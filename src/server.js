import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';

// APIs
import HistoryAPI from './api/history/index.js';
import PredictAPI from './api/predict/index.js';
import AlertsAPI from './api/alerts/index.js';
import MapsAPI from './api/maps/index.js';
import CommoditiesAPI from './api/commodities/index.js';
import AuthAPI from './api/auth/index.js';
import UsersAPI from './api/users/index.js';
import LogsAPI from './api/logs/index.js';
import WeatherAPI from './api/weather/index.js';

// Services
import HistoryService from './services/HistoryService.js';
import PredictService from './services/PredictService.js';
import AlertsService from './services/AlertsService.js';
import MapsService from './services/MapsService.js';
import CommoditiesService from './services/CommoditiesService.js';
import UserService from './services/UserService.js';
import AuthService from './services/AuthService.js';
import LogService from './services/LogService.js';
import WeatherService from './services/WeatherService.js';
import PredictionScheduler from './services/PredictionScheduler.js';

// Validators
import AuthValidator from './validator/auth/index.js';

// Middleware
import errorHandler from './middleware/error-handler.js';
import apiKeyMiddleware from './middleware/api-key.js';
import { pool } from './config/database.js';
import redisClient from './config/redis.js';

// Swagger
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './config/swagger.js';

const swaggerAuth = (req, res, next) => {
  const auth = { login: process.env.SWAGGER_USER || 'admin', password: process.env.SWAGGER_PASSWORD || 'admin123' };
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

  if (login && password && login === auth.login && password === auth.password) {
    return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="401"');
  res.status(401).send('Authentication required.');
};

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

// Middleware
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://localhost:5173'];

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-refresh-token', 'x-client-id'],
  credentials: true,
}));
app.use(express.json());

// Apply API Key Middleware to all routes except health check, root, and swagger
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/health' || req.path.startsWith('/api-docs')) {
    return next();
  }
  apiKeyMiddleware(req, res, next);
});

// Swagger Documentation Route (Protected with Basic Auth)
app.use('/api-docs', swaggerAuth, swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  swaggerOptions: {
    persistAuthorization: true,
  },
  customSiteTitle: 'SIPANGAN API Documentation',
}));

// Initialize Services
const logService = new LogService();
const predictService = new PredictService();
const alertsService = new AlertsService();
const historyService = new HistoryService(predictService, logService, alertsService);
const mapsService = new MapsService();
const commoditiesService = new CommoditiesService(logService);
const userService = new UserService();
const authService = new AuthService(userService);
const weatherService = new WeatherService();

// Start background prediction scheduler
const predictionScheduler = new PredictionScheduler(predictService);
predictionScheduler.start();

// Register API Routes (consistent plugin pattern)
HistoryAPI.register(app, { historyService });
PredictAPI.register(app, { predictService });
AlertsAPI.register(app, { alertsService });
MapsAPI.register(app, { mapsService });
CommoditiesAPI.register(app, { commoditiesService });
AuthAPI.register(app, { authService, validator: AuthValidator });
UsersAPI.register(app, { userService, logService });
LogsAPI.register(app, { logService });
WeatherAPI.register(app, { weatherService });

/**
 * @openapi
 * /:
 *   get:
 *     summary: Default Root Route (Public)
 *     description: Mengecek apakah API SIPANGAN sudah berjalan.
 *     tags: [Public]
 *     security: []
 *     responses:
 *       200:
 *         description: API is running
 */
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'SIPANGAN API is running',
  });
});

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health Check (Public)
 *     description: Mengecek status kesehatan database dan redis.
 *     tags: [Public]
 *     security: []
 *     responses:
 *       200:
 *         description: System is healthy
 */
app.get('/health', async (req, res) => {
  const healthStatus = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    services: {
      database: 'UNKNOWN',
      redis: 'UNKNOWN'
    }
  };

  // Check Database
  try {
    await pool.query('SELECT 1');
    healthStatus.services.database = 'CONNECTED';
  } catch (err) {
    healthStatus.status = 'ERROR';
    healthStatus.services.database = `DISCONNECTED: ${err.message}`;
  }

  // Check Redis
  try {
    if (redisClient.isOpen) {
      await redisClient.ping();
      healthStatus.services.redis = 'CONNECTED';
    } else {
      healthStatus.status = 'ERROR';
      healthStatus.services.redis = 'DISCONNECTED';
    }
  } catch (err) {
    healthStatus.status = 'ERROR';
    healthStatus.services.redis = `DISCONNECTED: ${err.message}`;
  }

  const statusCode = healthStatus.status === 'OK' ? 200 : 503;
  res.status(statusCode).json(healthStatus);
});

// Centralized Error Handling
app.use(errorHandler);

app.listen(port, () => {
  console.log(`SIPANGAN Backend listening at http://localhost:${port}`);
});
