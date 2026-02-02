const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// 配置
const config = {
  txtFile: 'C:\\Users\\ASUS\\Desktop\\video_paths.txt',
  dbFile: 'C:\\Users\\ASUS\\Desktop\\sqliteDatabase.db'
};

// 读取并解析文本文件
function readVideoPaths() {
  try {
    const content = fs.readFileSync(config.txtFile, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('读取或解析文本文件失败:', error.message);
    process.exit(1);
  }
}

// 连接到数据库
function connectToDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(config.dbFile, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(db);
      }
    });
  });
}

// 检查表是否存在，不存在则创建
function ensureTableExists(db) {
  return new Promise((resolve, reject) => {
    const createTableSql = `
      CREATE TABLE IF NOT EXISTS s5_tasks_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_data TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL
      );
    `;
    
    db.run(createTableSql, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

// 插入任务数据
function insertTasks(db, videoPaths) {
  return new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    const insertSql = 'INSERT INTO s5_tasks_queue (task_data, status, created_at, updated_at) VALUES (?, ?, ?, ?)';
    
    // 使用事务批量插入
    db.run('BEGIN TRANSACTION', (err) => {
      if (err) {
        reject(err);
        return;
      }
      
      const stmt = db.prepare(insertSql);
      let count = 0;
      
      for (const videoPath of videoPaths) {
        stmt.run(videoPath, 'PENDING', now, now, (err) => {
          if (err) {
            stmt.finalize();
            db.run('ROLLBACK');
            reject(err);
            return;
          }
          count++;
        });
      }
      
      stmt.finalize((err) => {
        if (err) {
          db.run('ROLLBACK');
          reject(err);
          return;
        }
        
        db.run('COMMIT', (err) => {
          if (err) {
            reject(err);
          } else {
            resolve(count);
          }
        });
      });
    });
  });
}

// 主函数
async function main() {
  console.log('开始处理...');
  
  // 1. 读取视频路径
  const videoPaths = readVideoPaths();
  console.log(`成功读取 ${videoPaths.length} 个视频路径`);
  
  // 2. 连接数据库
  const db = await connectToDatabase();
  console.log('已连接到SQLite数据库');
  
  try {
    // 3. 确保表存在
    await ensureTableExists(db);
    console.log('已确保s5_tasks_queue表存在');
    
    // 4. 插入数据
    const insertedCount = await insertTasks(db, videoPaths);
    console.log(`成功插入 ${insertedCount} 条任务数据`);
    
  } catch (error) {
    console.error('操作失败:', error.message);
  } finally {
    // 5. 关闭数据库连接
    db.close((err) => {
      if (err) {
        console.error('关闭数据库连接失败:', err.message);
      } else {
        console.log('已关闭数据库连接');
      }
    });
  }
}

// 执行主函数
main();