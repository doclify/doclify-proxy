import { ServerResponse } from 'http'

type CacheDriver = 'memory' | 'memcached' | 'redis'
export type CacheOptions = {
  name?: string
  driver?: {
    type: CacheDriver
    redis?: Record<string, any>
    memcached?: Record<string, any>
  }
  timeout?: number
  maxAge?: number
  allowStale?: boolean
}

export type DoclifyOptions = {
  path?: string
  url?: string
  repository?: string
  key?: string
  webhookToken?: string
  timeout?: number
  cache?: CacheOptions
}

export type DoclifyDefaultOptions = {
  path: string
  url?: string
  repository?: string
  key?: string
  webhookToken?: string
  timeout: number
  cache?: CacheOptions
}

export interface ICacheObject {
  expiresAt: number
  statusCode: number
  data: unknown
}

export interface IDoclifyResponse extends ServerResponse {
  cache?: ICacheObject
}
