const { Pool } = require('pg');
require('dotenv').config();

// Determine which database URL to use based on environment
const connectionString = process.env.NODE_ENV === 'production' 
  ? process.env.DATABASE_URL_PROD
  : process.env.DATABASE_URL_DEV;

const pool = new Pool({
  max: 20,        // Increase from default
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  connectionString,
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false
  } : false
});

// Test database connection
pool.on('connect', () => {
  console.log('Database connected successfully');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

module.exports = pool;