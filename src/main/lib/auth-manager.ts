import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { join } from 'path';
import { app } from 'electron';

// 定义用户数据类型
export interface UserData {
  id: number;
  mobile: string;
  role: number;
  realName: string;
  avatar?: string;
  [key: string]: any; // 允许其他任意属性
}

// 定义存储的数据结构
interface AuthStoreSchema {
  auth: {
    isLoggedIn: boolean;
    userData: UserData | null;
    token: string | null;
    refreshToken: string | null;
    expiresAt: string | null; // 存储为ISO字符串
  };
}

export type Auth = AuthStoreSchema['auth'];

// 默认数据
const defaultData: AuthStoreSchema = {
  auth: {
    isLoggedIn: false,
    userData: null,
    token: null,
    refreshToken: null,
    expiresAt: null,
  },
};

class AuthManager {
  private db: Low<AuthStoreSchema>;

  constructor() {
    // 获取用户数据目录
    const userDataPath = app.getPath('userData');
    const dbPath = join(userDataPath, 'auth.json');

    // 创建 JSON 文件适配器
    const adapter = new JSONFile<AuthStoreSchema>(dbPath);

    // 创建 Low 实例
    this.db = new Low<AuthStoreSchema>(adapter, defaultData);

    // 初始化数据库
    this.init();
  }

  /**
   * 初始化数据库
   */
  private async init(): Promise<void> {
    await this.db.read();

    // 如果数据为空，则设置默认值
    if (!this.db.data) {
      this.db.data = defaultData;
      await this.db.write();
    }
  }

  /**
   * 检查是否已登录
   * @returns {Promise<boolean>} 登录状态
   */
  public async isLoggedIn(): Promise<boolean> {
    await this.db.read();
    const isLoggedIn = this.db.data.auth.isLoggedIn;
    const expiresAt = this.db.data.auth.expiresAt;

    if (!isLoggedIn) return false;

    // 检查token是否过期
    if (expiresAt && new Date(expiresAt) < new Date()) {
      await this.clearLoginState();
      return false;
    }

    return true;
  }

  /**
   * 设置登录状态
   * @param {UserData} userData - 用户数据
   * @param {string} [token] - 认证token
   * @param {string} [refreshToken] - 认证刷新token
   * @param {Date} [expiresAt] - 过期时间
   */
  public async setLoginState(
    userData: UserData,
    token?: string,
    refreshToken?: string,
    expiresAt?: Date
  ): Promise<void> {
    await this.db.read();

    this.db.data.auth.isLoggedIn = true;
    this.db.data.auth.userData = userData;

    if (token) {
      this.db.data.auth.token = token;
    }

    if (refreshToken) {
      this.db.data.auth.refreshToken = refreshToken;
    }

    if (expiresAt) {
      this.db.data.auth.expiresAt = expiresAt.toISOString();
    }

    await this.db.write();
  }

  /**
   * 清除登录状态
   */
  public async clearLoginState(): Promise<void> {
    await this.db.read();

    this.db.data.auth.isLoggedIn = false;
    this.db.data.auth.userData = null;
    this.db.data.auth.token = null;
    this.db.data.auth.refreshToken = null;
    this.db.data.auth.expiresAt = null;

    await this.db.write();
  }

  /**
   * 获取登录信息
   * @returns {Promise<UserData | null>} 用户数据
   */
  public async getAuthInfo(): Promise<AuthStoreSchema['auth'] | null> {
    await this.db.read();
    return this.db.data.auth;
  }

  /**
   * 获取用户信息
   * @returns {Promise<UserData | null>} 用户数据
   */
  public async getUserInfo(): Promise<UserData | null> {
    await this.db.read();
    return this.db.data.auth.userData;
  }

  /**
   * 获取token
   * @returns {Promise<string | null>} 认证token
   */
  public async getToken(): Promise<string | null> {
    await this.db.read();
    return this.db.data.auth.token;
  }

  /**
   * 获取refreshToken
   * @returns {Promise<string | null>} 认证token
   */
  public async getRefreshToken(): Promise<string | null> {
    await this.db.read();
    return this.db.data.auth.refreshToken;
  }

  /**
   * 获取token过期时间
   * @returns {Promise<Date | null>} 过期时间
   */
  public async getExpiresAt(): Promise<Date | null> {
    await this.db.read();
    const expiresAtStr = this.db.data.auth.expiresAt;
    return expiresAtStr ? new Date(expiresAtStr) : null;
  }

  /**
   * 更新用户信息
   * @param {Partial<UserData>} userData - 部分用户数据
   */
  public async updateUserData(userData: Partial<UserData>): Promise<void> {
    await this.db.read();

    if (this.db.data.auth.userData) {
      this.db.data.auth.userData = {
        ...this.db.data.auth.userData,
        ...userData,
      };
      await this.db.write();
    }
  }

  /**
   * 检查token是否即将过期（在指定时间内）
   * @param {number} minutes - 分钟数
   * @returns {Promise<boolean>} 是否即将过期
   */
  public async isTokenExpiringSoon(minutes: number = 30): Promise<boolean> {
    const expiresAt = await this.getExpiresAt();
    if (!expiresAt) return false;

    const now = new Date();
    const expiryTime = new Date(expiresAt.getTime() - minutes * 60000);

    return now > expiryTime;
  }
}

const authManager = new AuthManager();

export default authManager;
