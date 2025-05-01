const { Pool } = require('pg');

const pool = new Pool({
  user: 'laynemcintosh12', // Replace with your PostgreSQL username
  host: 'localhost',
  database: 'am-website', // Your database name
  password: 'password', // Replace with your PostgreSQL password
  port: 5432, // Default PostgreSQL port
});

module.exports = pool;