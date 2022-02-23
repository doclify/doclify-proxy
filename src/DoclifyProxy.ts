import { IncomingMessage } from 'http'
import defu from 'defu'
import cached from 'cached'
import { createProxyMiddleware, RequestHandler, responseInterceptor } from 'http-proxy-middleware'
import { DoclifyProxyDefaultOptions, DoclifyProxyOptions, ICacheObject, IDoclifyResponse } from './types'

const defaults: DoclifyProxyDefaultOptions = {
  path: '/doclify',
  timeout: 5000
}

export default class DoclifyProxy {
  public options: DoclifyProxyDefaultOptions
  public proxy: RequestHandler
  public cache?: ReturnType<typeof cached.createCache>

  constructor (options?: DoclifyProxyOptions) {
    this.options = defu((options as DoclifyProxyDefaultOptions) || {}, defaults)

    if (!this.options.url) {
      if (!this.options.repository) {
        throw new TypeError('Repository or URL option is required.')
      }

      if (!this.options.key) {
        throw new TypeError('API key is required.')
      }
    }

    if (this.options.cache) {
      this.cache = this.createCache()
    }

    this.proxy = this.createProxy()
  }

  public get url (): string {
    return this.options.url || `https://${this.options.repository ?? ''}.cdn.doclify.io/api/v2`
  }

  public get cacheMaxAge () {
    return this.options.cache?.maxAge ?? 60 * 60
  }

  private createCache () {
    const options = this.options.cache!
    const driver = options.driver?.type ?? 'memory'
    const driverOptions: any = options.driver ?? {}
    const specificDriverOptions = driverOptions[driver] || {}

    const cache = cached.createCache({
      name: this.options.cache?.name ?? 'doclify',
      backend: {
        type: driver,
        ...specificDriverOptions
      },
      defaults: {
        expire: options.allowStale === false ? this.cacheMaxAge : 0,
        timeout: options.timeout || 10000
      }
    })

    return cache
  }

  private createProxy () {
    const headers: Record<string, string> = {}

    if (this.options.key) {
      headers.Authorization = 'Bearer ' + this.options.key
    }

    return createProxyMiddleware(this.options.path, {
      changeOrigin: true,
      headers,
      target: this.url,
      pathRewrite: { ['^' + this.options.path]: '' },
      selfHandleResponse: !!this.options.cache,
      onProxyRes: this.options.cache ? this.onProxyRes : undefined
    })
  }

  // eslint-disable-next-line require-await
  private onProxyRes = responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
    if (!this.cache) {
      return responseBuffer
    }

    const doclifyRes = res as IDoclifyResponse

    const key = req.url ?? ''

    if (doclifyRes.statusCode >= 500) {
      if (doclifyRes.cache) {
        res.statusCode = doclifyRes.cache.statusCode
        res.setHeader('content-type', 'application/json')

        return doclifyRes.cache.data as string
      }
    }

    if (res.statusCode < 500) {
      this.cache
        .set(key, {
          statusCode: proxyRes.statusCode ?? -1,
          expiresAt: Math.ceil(Date.now() / 1000) + this.cacheMaxAge,
          data: responseBuffer.toString('utf-8')
        })
        .catch((err) => {
          console.warn('Failed to save cache:', err.message)
        })
    }

    return responseBuffer
  })

  public middleware = async (req: IncomingMessage, res: IDoclifyResponse, next: () => void) => {
    const proxy = this.proxy as any
    const url = req.url ?? ''

    if (url.indexOf(this.options.path) !== 0) {
      return next()
    }

    if (!this.cache) {
      return proxy(req, res, next)
    }

    const key = url.replace(new RegExp('^' + this.options.path), '')

    if (key === '/webhook') {
      return this.handleWebhook(req, res)
    }

    const cache = (await this.cache.get(key)) as ICacheObject | null

    if (cache) {
      if (
        this.options.cache?.allowStale === false ||
        cache.expiresAt >= Math.floor(Date.now() / 1000)
      ) {
        res.statusCode = cache.statusCode
        res.setHeader('content-type', 'application/json')
        return res.end(cache.data)
      } else {
        res.cache = cache
      }
    }

    return proxy(req, res, next)
  }

  private handleWebhook = (req: IncomingMessage, res: IDoclifyResponse) => {
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')

    let status = false

    if (
      !this.options.webhookToken ||
      this.options.webhookToken === req.headers['x-doclify-token']
    ) {
      status = true
      const anyCache = this.cache as any
      anyCache?.flush()
    }

    return res.end(JSON.stringify({ status }))
  }
}
