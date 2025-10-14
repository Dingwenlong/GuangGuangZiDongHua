export const token_key = "authorization";
export const refresh_token_key = "x-authorization";

const getToken = (): string | null | undefined => {
  if (token_key) return localStorage.getItem(token_key);
};

const setToken = (token: string): void => {
  if (token_key) return localStorage.setItem(token_key, token);
};

const removeToken = (): void => {
  if (token_key) return localStorage.removeItem(token_key);
};

const getRefreshToken = (): string | null | undefined => {
  if (refresh_token_key) return localStorage.getItem(refresh_token_key);
};

const setRefreshToken = (token: string): void => {
  if (refresh_token_key) return localStorage.setItem(refresh_token_key, token);
};

const removeRefreshToken = (): void => {
  if (refresh_token_key) return localStorage.removeItem(refresh_token_key);
};

function decryptJWT(token: string): any {
  token = token.replace(/_/g, "/").replace(/-/g, "+");
  var json = decodeURIComponent(escape(window.atob(token.split(".")[1])));
  return JSON.parse(json);
}

export {
  getToken,
  getRefreshToken,
  setToken,
  setRefreshToken,
  removeToken,
  removeRefreshToken,
  decryptJWT,
};
