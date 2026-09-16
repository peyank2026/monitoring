const mariadb = require('mariadb');
require('dotenv').config();

const pool = mariadb.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'switch_monitor',
  timezone: '+07:00',
  connectionLimit: 10,
  acquireTimeout: 30000
});

// Test connection on startup
pool.getConnection()
  .then(conn => {
    console.log('✅ MariaDB connected successfully');
    conn.release();
  })
  .catch(err => {
    console.error('❌ MariaDB connection failed:', err.message);
  });

module.exports = pool;
