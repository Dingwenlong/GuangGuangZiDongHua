import axios, {
  AxiosResponse,
  AxiosRequestConfig,
  AxiosError,
  InternalAxiosRequestConfig,
  AxiosInstance,
} from 'axios';
import { HttpCodeConfig } from './http-code';
import {
  ResponseModel,
  UploadFileItemModel,
  UploadRequestConfig,
} from './types/index';
import {
  token_key,
  refresh_token_key,
  getToken,
  getRefreshToken,
  setToken,
  setRefreshToken,
} from '@renderer/utils/token';
import { messageApi } from '@renderer/hooks/message';

class HttpRequest {
  service: AxiosInstance;

  constructor() {
    this.service = axios.create({
      baseURL: __CONFIG__.BASE_API,
      timeout: 5 * 1000,
    });

    this.service.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        /**
         * set your config
         */
        const token = getToken();
        const refreshToken = getRefreshToken();
        if (token) {
          config.headers[token_key] = `Bearer ${token}`;
        }
        if (refreshToken) {
          config.headers[refresh_token_key] = `Bearer ${refreshToken}`;
        }
        return config;
      },
      (error: AxiosError) => {
        console.log('requestError: ', error);
        return Promise.reject(error);
      },
      {
        synchronous: true,
        runWhen: (config: InternalAxiosRequestConfig) => {
          return true;
        },
      }
    );

    this.service.interceptors.response.use(
      (
        response: AxiosResponse<ResponseModel>
      ): AxiosResponse<ResponseModel> | Promise<never> => {
        const { data, headers } = response;
        const { statusCode } = data;
        if (statusCode) {
          if (statusCode != HttpCodeConfig.success) {
            switch (statusCode) {
              case HttpCodeConfig.notFound:
                // the method to handle this code
                messageApi.error('404');
                break;
              case HttpCodeConfig.noPermission:
                // the method to handle this code
                messageApi.error('没有权限');
                break;
              case HttpCodeConfig.serverError:
                // the method to handle this code
                messageApi.error(data.errors);
                break;
              default:
                break;
            }
            return Promise.reject(data.errors);
          } else {
            if (headers['access-token']) {
              setToken(headers['access-token']);
            }
            if (headers['x-access-token']) {
              setRefreshToken(headers['x-access-token']);
            }
            return response;
          }
        } else {
          return Promise.reject('Error! code missing!');
        }
      },
      (error: any) => {
        // 判断请求异常信息中是否含有超时timeout字符串
        if (error.message.includes('timeout')) {
          console.log('错误回调', error);
        }
        if (error.message.includes('Network Error')) {
          console.log('错误回调', error);
        }
        return Promise.reject(error);
      }
    );
  }

  request<T = any>(config: AxiosRequestConfig): Promise<ResponseModel<T>> {
    return new Promise((resolve, reject) => {
      try {
        this.service
          .request<ResponseModel<T>>(config)
          .then((res: AxiosResponse<ResponseModel<T>>) => {
            resolve(res.data);
          })
          .catch(err => {
            reject(err);
          });
      } catch (err) {
        return Promise.reject(err);
      }
    });
  }

  requestWithHeaders<T = any>(
    config: AxiosRequestConfig
  ): Promise<{ data: ResponseModel<T>; headers: any }> {
    return new Promise((resolve, reject) => {
      try {
        this.service
          .request<ResponseModel<T>>(config)
          .then((res: AxiosResponse<ResponseModel<T>>) => {
            resolve({
              data: res.data,
              headers: res.headers,
            });
          })
          .catch(err => {
            reject(err);
          });
      } catch (err) {
        return Promise.reject(err);
      }
    });
  }

  get<T = any>(config: AxiosRequestConfig): Promise<ResponseModel<T>> {
    return this.request({ method: 'GET', ...config });
  }
  post<T = any>(config: AxiosRequestConfig): Promise<ResponseModel<T>> {
    return this.request({ method: 'POST', ...config });
  }
  put<T = any>(config: AxiosRequestConfig): Promise<ResponseModel<T>> {
    return this.request({ method: 'PUT', ...config });
  }
  delete<T = any>(config: AxiosRequestConfig): Promise<ResponseModel<T>> {
    return this.request({ method: 'DELETE', ...config });
  }
  upload<T = string>(
    fileItem: UploadFileItemModel,
    config?: UploadRequestConfig
  ): Promise<ResponseModel<T>> | null {
    if (!__CONFIG__.UPLOAD_URL) return null;

    let fd = new FormData();
    fd.append(fileItem.name, fileItem.value);
    let configCopy: UploadRequestConfig;
    if (!config) {
      configCopy = {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      };
    } else {
      config.headers!['Content-Type'] = 'multipart/form-data';
      configCopy = config;
    }
    return this.request({
      url: __CONFIG__.UPLOAD_URL,
      data: fd,
      ...configCopy,
    });
  }
}

const serves = new HttpRequest();
export default serves;
