const { Pool } = require('pg');
require('dotenv').config();

// Determine which database URL to use based on environment
const connectionString = process.env.NODE_ENV === 'production' 
  ? process.env.DATABASE_URL_PROD
  : process.env.DATABASE_URL_DEV;

// Log which database is being used
console.log('=== DATABASE CONNECTION INFO ===');
console.log('Environment:', process.env.NODE_ENV || 'development');
console.log('Using database:', process.env.NODE_ENV === 'production' ? 'PRODUCTION' : 'DEVELOPMENT');
console.log('Connection string (masked):', connectionString ? connectionString.replace(/\/\/.*@/, '//***:***@') : 'Not found');
console.log('================================');

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
pool.on('connect', (client) => {
  console.log('✅ Database connected successfully to:', process.env.NODE_ENV === 'production' ? 'PRODUCTION DB' : 'DEVELOPMENT DB');
  
  // Get database name from the connection
  client.query('SELECT current_database()', (err, result) => {
    if (!err) {
      console.log('📊 Connected to database name:', result.rows[0].current_database);
    }
  });
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err);
  process.exit(-1);
});

module.exports = pool;