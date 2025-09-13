// 프로젝트 루트의 .env 파일 명시적으로 로드
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

async function testConnection() {
  console.log('Testing database connection...');
  
  // .env 파일 로딩 확인
  const path = require('path');
  const fs = require('fs');
  const envPath = path.join(process.cwd(), '.env');
  console.log('Looking for .env at:', envPath);
  console.log('.env file exists:', fs.existsSync(envPath));
  
  // 실제 환경변수 값 출력
  console.log('Raw env values:', {
    DB_HOST: JSON.stringify(process.env.DB_HOST),
    DB_USER: JSON.stringify(process.env.DB_USER), 
    DB_NAME: JSON.stringify(process.env.DB_NAME),
    DB_PORT: JSON.stringify(process.env.DB_PORT),
    DB_PASSWORD: process.env.DB_PASSWORD ? 'SET' : 'NOT_SET'
  });

  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: Number(process.env.DB_PORT || 3306),
    });

    console.log('✅ Database connection successful!');
    
    // 간단한 쿼리 테스트
    const [rows] = await connection.execute('SELECT 1 as test');
    console.log('✅ Query test successful:', rows);
    
    await connection.end();
  } catch (error) {
    console.error('❌ Database connection failed:', error);
  }
}

testConnection();