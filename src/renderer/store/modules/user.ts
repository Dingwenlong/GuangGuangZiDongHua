import { defineStore } from 'pinia';
import pinia from '@renderer/store';
import { login, changePwd } from '@renderer/api/account';
import type { UserData } from '@main/services/auth-manager';
import { ref, onMounted } from 'vue';
import { setToken, setRefreshToken } from '@renderer/utils/token';

interface TokenData {
  token?: string;
  refreshToken?: string;
}

const { ipcRendererChannel } = window;
export const useStoreUser = defineStore('user', () => {
  const loginAccountKey = 'client_app_login_account';
  const userData = ref<UserData | null>();
  const tokenData = ref<TokenData | null>();

  const loginAction = async (loginData: any) => {
    try {
      const { data, headers } = await login(loginData);
      saveLocalAccount(loginData);
      const token = headers['access-token'];
      const refreshToken = headers['x-access-token'];
      const resUserData = {
        id: data.data.admin_id,
        mobile: data.data.mobile,
        role: data.data.role_id,
        realName: data.data.realname,
        avatar: data.data.headimgurl,
      } satisfies UserData;
      await ipcRendererChannel.LoginSuccess.invoke({
        userData: resUserData,
        token: token,
        refreshToken: refreshToken,
      });
      return Promise.resolve(data);
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const logoutAction = async () => {
    if (!userData.value) {
      return;
    }
    ipcRendererChannel.Logout.invoke();
  };
  const getLocalAccount = (): any => {
    const data = localStorage.getItem(loginAccountKey);
    if (!data) {
      return;
    }
    return JSON.parse(data);
  };
  const saveLocalAccount = (data: object) => {
    if (!data) {
      return;
    }
    localStorage.setItem(loginAccountKey, JSON.stringify(data));
  };
  const changeAccountPwd = (data: { password: string }) => {
    const res = changePwd(data);
    const localAccount = getLocalAccount();
    localAccount.password = '';
    saveLocalAccount(localAccount);
    return res;
  };

  async function init() {
    if (!(await loginState())) {
      return;
    }

    const authInfo = await ipcRendererChannel.GetAuthInfo.invoke();
    if (authInfo.userData) {
      userData.value = authInfo.userData;
    }
    if (authInfo.token && authInfo.refreshToken) {
      tokenData.value = {
        token: authInfo.token,
        refreshToken: authInfo.refreshToken,
      };
      setToken(authInfo.token);
      setRefreshToken(authInfo.refreshToken);
    }
  }

  async function loginState(): Promise<boolean> {
    return await ipcRendererChannel.GetLoginState.invoke();
  }

  return {
    userData,
    tokenData,
    loginState,
    loginAction,
    logoutAction,
    getLocalAccount,
    changeAccountPwd,
    init,
  };
});

export function useStoreUserWithOut() {
  return useStoreUser(pinia);
}
