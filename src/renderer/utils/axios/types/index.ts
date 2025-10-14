import { AxiosRequestConfig } from "axios";

export interface ResponseModel<T = any> {
  statusCode: number | string;
  succeeded: boolean;
  errors: string | null;
  data: T | null;
  timestamp: number;
}

export interface UploadFileItemModel {
  name: string;
  value: string | Blob;
}

/**
 * customize your uploadRequestConfig
 */
export type UploadRequestConfig = Omit<AxiosRequestConfig, "url" | "data">;
