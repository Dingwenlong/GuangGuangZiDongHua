import { app } from 'electron';
import * as path from 'path';
import * as sqlite3 from 'sqlite3';

const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'sqliteDatabase.db');

export interface queryParam {
  sql: string;
  params?: any[];
}

export interface insertParam {
  table: string;
  data: { [key: string]: any };
}

export interface updateParam {
  table: string;
  data: { [key: string]: any };
  condition: string;
}

export interface deleteParam {
  table: string;
  condition: string;
}

export class Database {
  private static instance: Database | null = null;
  private static instancePromise: Promise<Database> | null = null;
  private db: sqlite3.Database | null = null;

  private constructor() {
    // 不在构造函数中立即创建数据库连接
  }

  static async getInstance(): Promise<Database> {
    // 避免多次初始化的竞态条件
    if (Database.instancePromise) {
      return Database.instancePromise;
    }

    Database.instancePromise = (async () => {
      if (!Database.instance) {
        Database.instance = new Database();
        await Database.instance.open();
      }
      return Database.instance;
    })();

    return Database.instancePromise;
  }

  private open(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // 添加超时处理，避免无限等待
      const timeoutId = setTimeout(() => {
        reject(new Error('Database connection timeout'));
      }, 10000); // 10秒超时

      try {
        // 在open方法中创建数据库连接
        this.db = new sqlite3.Database(dbPath, err => {
          clearTimeout(timeoutId);
          if (err) {
            console.error('Error opening database:', err);
            reject(err);
            return;
          }

          this.db!.serialize(() => {
            this.db!.run('PRAGMA foreign_keys = ON', err => {
              if (err) {
                console.error('Error setting PRAGMA:', err);
                reject(err);
              } else {
                console.log('Connected to the database.');
                resolve();
              }
            });
          });
        });
      } catch (error) {
        clearTimeout(timeoutId);
        console.error('Exception during database initialization:', error);
        reject(error);
      }
    });
  }

  close(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.db) {
        resolve();
        return;
      }

      this.db.close(err => {
        if (err) {
          console.error('Error closing database:', err);
          reject(err);
        } else {
          console.log('Database closed.');
          this.db = null;
          resolve();
        }
      });
    });
  }

  query(param: queryParam): Promise<any[]> {
    return new Promise<any[]>((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      // 添加超时处理
      const timeoutId = setTimeout(() => {
        reject(new Error('Database query timeout'));
      }, 15000); // 15秒超时

      this.db.all(param.sql, param.params, (err, rows) => {
        clearTimeout(timeoutId);
        if (err) {
          console.error('Database query error:', err, 'SQL:', param.sql);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  insert(param: insertParam): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const keys = Object.keys(param.data);
      const values = Object.values(param.data);
      const placeholders = keys.map(() => '?').join(',');
      const sql = `INSERT INTO ${param.table} (${keys.join(
        ','
      )}) VALUES (${placeholders})`;

      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      this.db.run(sql, values, function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
    });
  }

  update(param: updateParam): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const entries = Object.entries(param.data)
        .map(([key, value]) => `${key} = ?`)
        .join(',');
      const params = Object.values(param.data);
      const sql = `UPDATE ${param.table} SET ${entries} WHERE ${param.condition}`;

      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      this.db.run(sql, params, function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }

  delete(param: deleteParam): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const sql = `DELETE FROM ${param.table} WHERE ${param.condition}`;

      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      this.db.run(sql, err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

// Wrap database calls to ensure initialization with better error handling
const getDatabase = async (): Promise<Database> => {
  try {
    return await Database.getInstance();
  } catch (error) {
    console.error('Failed to get database instance:', error);
    throw error;
  }
};

export const sqQuery = async (param: queryParam) => {
  try {
    const db = await getDatabase();
    return await db.query(param);
  } catch (error) {
    console.error('Database query failed:', error);
    throw error;
  }
};

export const sqInsert = async (param: insertParam) => {
  try {
    const db = await getDatabase();
    return await db.insert(param);
  } catch (error) {
    console.error('Database insert failed:', error);
    throw error;
  }
};

export const sqUpdate = async (param: updateParam) => {
  try {
    const db = await getDatabase();
    return await db.update(param);
  } catch (error) {
    console.error('Database update failed:', error);
    throw error;
  }
};

export const sqDelete = async (param: deleteParam) => {
  try {
    const db = await getDatabase();
    return await db.delete(param);
  } catch (error) {
    console.error('Database delete failed:', error);
    throw error;
  }
};
