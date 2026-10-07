import axios from 'axios'
import express from 'express'
import { Readable } from 'stream'
import supertest, { Session } from 'supertest-session'

import config from '../../../config/config'
import {
  catchNonExistentStaticRoutesMiddleware,
  errorHandlerMiddlewares,
  getStaticAssetUrl,
} from '../error-handler'
import parserMiddlewares from '../parser'

jest.mock('axios')
const MockAxios = jest.mocked(axios)

describe('error-handler.loader', () => {
  let request: Session
  describe('body-parser errors', () => {
    // Test preparation
    const app = express()
    app
      .use(parserMiddlewares())
      .post('/', (_req, res) => {
        res.sendStatus(200)
      })
      .use(errorHandlerMiddlewares())

    beforeEach(() => {
      request = supertest(app)
    })

    it('should catch invalid json bodies', async () => {
      // Arrange + Act
      const response = await request
        .post('/')
        .send('{"invalid json"}')
        .type('json')

      // Assert
      expect(response.status).toEqual(400)
      expect(response.text).toContain('"message":"Expected \':\'')
    })
  })

  describe('getStaticAssetUrl', () => {
    const BUCKET_URL = 'https://s3.ap-southeast-1.amazonaws.com/static-bucket'

    it('should resolve paths within the static assets bucket', () => {
      expect(getStaticAssetUrl('/static/js/main.js?v=1#x', BUCKET_URL)).toEqual(
        `${BUCKET_URL}/static/js/main.js`,
      )
      expect(getStaticAssetUrl('/robots.txt', `${BUCKET_URL}/`)).toEqual(
        `${BUCKET_URL}/robots.txt`,
      )
      expect(getStaticAssetUrl('/static/a%20b.png', BUCKET_URL)).toEqual(
        `${BUCKET_URL}/static/a%20b.png`,
      )
    })

    it.each([
      '/static/../../other-bucket/secret.txt',
      '/static/..\\..\\other-bucket/secret.txt',
      '/static/%2e%2e/%2e%2e/other-bucket/secret.txt',
      '/static/%2E%2E/%2E%2E/other-bucket/secret.txt',
      '/static/.%2e/.%2e/other-bucket/secret.txt',
      '/static/%2e%2e%2f%2e%2e%2fother-bucket/secret.txt',
      '/static/..%5c..%5cother-bucket/secret.txt',
      '/static/./x.js',
      '/static/%2e/x.js',
      '/static/x%00.js',
      '/static/%E0%A4%A.js',
      '/static/..',
      '/static/%2e%2e',
    ])('should reject path that may escape the bucket: %s', (url) => {
      expect(getStaticAssetUrl(url, BUCKET_URL)).toBeNull()
    })
  })

  describe('catchNonExistentStaticRoutesMiddleware', () => {
    const app = express()
    app.get(
      /^\/(public|static|assets)\//,
      catchNonExistentStaticRoutesMiddleware,
    )

    beforeEach(() => {
      request = supertest(app)
      MockAxios.get.mockReset()
    })

    it('should proxy the asset from the static bucket with allowlisted headers only', async () => {
      // Arrange
      MockAxios.get.mockResolvedValueOnce({
        data: Readable.from(['asset-body']),
        status: 200,
        headers: {
          'content-type': 'image/png',
          'cache-control': 'max-age=60',
          'set-cookie': 'evil=1',
          'x-amz-meta-internal': 'secret',
        },
      })

      // Act
      const response = await request.get('/static/file.txt?list-type=2')

      // Assert
      expect(MockAxios.get).toHaveBeenCalledWith(
        `${config.aws.staticAssetsBucketUrl}/static/file.txt`,
        { responseType: 'stream' },
      )
      expect(response.status).toEqual(200)
      expect(Buffer.from(response.body).toString()).toEqual('asset-body')
      expect(response.headers['content-type']).toEqual('image/png')
      expect(response.headers['cache-control']).toEqual('max-age=60')
      expect(response.headers['set-cookie']).toBeUndefined()
      expect(response.headers['x-amz-meta-internal']).toBeUndefined()
    })

    it('should return 404 without fetching for percent-encoded traversal', async () => {
      // Act
      const response = await request.get(
        '/static/%2e%2e/%2e%2e/other-bucket/secret.txt',
      )

      // Assert
      expect(response.status).toEqual(404)
      expect(MockAxios.get).not.toHaveBeenCalled()
    })

    it('should return 404 when the asset cannot be fetched', async () => {
      // Arrange
      MockAxios.get.mockRejectedValueOnce(new Error('not found'))

      // Act
      const response = await request.get('/static/missing.js')

      // Assert
      expect(response.status).toEqual(404)
    })
  })
})
