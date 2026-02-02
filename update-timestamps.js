const sqlite3 = require('sqlite3').verbose();

// 配置
const config = {
  dbFile: 'C:\\Users\\ASUS\\Desktop\\sqliteDatabase.db'
};

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

// 更新created_at和updated_at为13位毫秒时间戳
function updateTimestampsToMilliseconds(db) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now(); // 获取当前13位毫秒时间戳
    const updateSql = 'UPDATE s5_tasks_queue SET created_at = ?, updated_at = ?';
    
    db.run(updateSql, [timestamp, timestamp], function(err) {
      if (err) {
        reject(err);
      } else {
        resolve(this.changes);
      }
    });
  });
}

// 主函数
async function main() {
  console.log('开始更新时间戳字段...');
  
  // 1. 连接数据库
  const db = await connectToDatabase();
  console.log('已连接到SQLite数据库');
  
  try {
    // 2. 更新时间戳为13位毫秒时间戳
    const updatedCount = await updateTimestampsToMilliseconds(db);
    console.log(`成功更新 ${updatedCount} 条记录的时间戳字段为13位毫秒时间戳`);
    
  } catch (error) {
    console.error('操作失败:', error.message);
  } finally {
    // 3. 关闭数据库连接
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