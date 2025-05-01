const pool = require('./config/db');  // This path is correct since we're in backend directory

async function testConnection() {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT NOW()');
        console.log('Database connected successfully:', result.rows[0]);
        await client.release();
    } catch (err) {
        console.error('Error connecting to database:', err);
    } finally {
        process.exit();
    }
}

testConnection();