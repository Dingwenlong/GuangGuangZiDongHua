import httpRequest from "@renderer/utils/axios/axios";

export function login(data: any) {
  return httpRequest.requestWithHeaders<any>({
    method: "post",
    url: "/api/auth/admin",
    data,
  });
}

export function changePwd(data: any) {
  return httpRequest.post<any>({
    url: '/api/auth/changepwd',
    data,
  });
}
