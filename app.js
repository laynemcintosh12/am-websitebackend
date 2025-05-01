const express = require('express');
const cors = require('cors'); // Import the CORS middleware
const cron = require('node-cron');
const { syncCustomers } = require('./controllers/customerController'); // Import the sync function
const customerRoutes = require('./routes/customerRoutes');
const commissionRoutes = require('./routes/commissionRoutes');
const userRoutes = require('./routes/userRoutes');
const teamRoutes = require('./routes/teamRoutes');
const emailRoutes = require('./routes/emailRoutes'); // Add this with other route imports
const { globalErrorHandler } = require('./utils/error');
const pool = require('./config/db'); // Database connection
const logger = require('./utils/logger'); // Logger utility

const app = express();

// Enable CORS for requests from the frontend
app.use(cors({ origin: 'http://localhost:5173' })); // Replace with your frontend's URL in production

// Middleware to log every route hit
app.use((req, res, next) => {
  logger.info(`Route hit: ${req.method} ${req.originalUrl}`);
  next();
});

// Middleware to handle favicon.ico requests
app.use((req, res, next) => {
  if (req.originalUrl === '/favicon.ico') {
    res.status(204).end(); // No Content
  } else {
    next();
  }
});

// Middleware to parse JSON
app.use(express.json());

// Add this to your Express app setup (app.js or index.js)
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`, req.body);
  next();
});

// Routes
app.use('/api/customers', customerRoutes);
app.use('/api/', commissionRoutes);
app.use('/api/users', userRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/email', emailRoutes); // Add this with other route uses

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection failed:', err.message);
  } else {
    console.log('Database connected successfully:', res.rows[0].now);
  }
});

// Schedule a daily sync at midnight (00:00)
cron.schedule('0 0 * * *', async () => {
  console.log('Running daily customer sync...');
  try {
    await syncCustomers(); // Call the sync function
    console.log('Daily customer sync completed successfully.');
  } catch (error) {
    console.error('Error during daily customer sync:', error.message);
  }
});

// Global error handler
app.use(globalErrorHandler);

module.exports = app;