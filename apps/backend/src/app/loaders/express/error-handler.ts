import axios from 'axios'
import { errors, isCelebrateError } from 'celebrate'
import { ErrorRequestHandler, RequestHandler } from 'express'
import { HttpError, isHttpError } from 'http-errors'
import { StatusCodes } from 'http-status-codes'
import get from 'lodash/get'
import { types } from 'util'

import config from '../../config/config'
import { createLoggerWithLabel } from '../../config/logger'
import { createReqMeta } from '../../utils/request'

const logger = createLoggerWithLabel(module)
const celebrateErrorHandler = errors()

const isBodyParserError = (
  err: unknown,
): err is HttpError & { type: string } => {
  return isHttpError(err) && 'type' in err
}

const isHTTPLikeError = (
  err: unknown,
): err is Error & { statusCode: number } => {
  return types.isNativeError(err) && 'statusCode' in err
}

const STATIC_ASSET_FORWARDED_HEADERS = [
  'content-type',
  'content-length',
  'content-encoding',
  'cache-control',
  'etag',
  'last-modified',
] as const

/**
 * Builds the URL of the requested asset within the static assets bucket.
 * Returns null if the request path could resolve to anything outside the
 * static assets bucket (e.g. via plain or percent-encoded dot segments).
 */
export const getStaticAssetUrl = (
  originalUrl: string,
  staticAssetsBucketUrl: string,
): string | null => {
  // Drop query and hash; only the path is forwarded to the bucket
  const path = originalUrl.split(/[?#]/)[0]

  if (!path.startsWith('/') || /%(2f|5c)/i.test(path)) return null

  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(path)
  } catch {
    return null
  }

  if (
    /[\\\0]/.test(decodedPath) ||
    decodedPath
      .split('/')
      .some((segment) => segment === '.' || segment === '..')
  ) {
    return null
  }

  const bucketUrl = new URL(staticAssetsBucketUrl)
  const bucketPathPrefix = `${bucketUrl.pathname.replace(/\/+$/, '')}/`
  const assetUrl = new URL(
    `${bucketUrl.origin}${bucketPathPrefix.slice(0, -1)}${path}`,
  )

  if (
    assetUrl.origin !== bucketUrl.origin ||
    !assetUrl.pathname.startsWith(bucketPathPrefix)
  ) {
    return null
  }

  return assetUrl.toString()
}

// If static no middleware responded
export const catchNonExistentStaticRoutesMiddleware: RequestHandler = async (
  req,
  res,
) => {
  // Attempt to fetch from s3 bucket

  try {
    const assetUrl = getStaticAssetUrl(
      req.originalUrl,
      config.aws.staticAssetsBucketUrl,
    )

    if (!assetUrl) {
      // Path could escape the static assets bucket, we do not expect or allow that
      throw new Error('Non-redirectable URL')
    }

    const { data, status, headers } = await axios.get(assetUrl, {
      responseType: 'stream',
    })
    // If get request succeeds pipe the data back
    logger.info({
      message: 'Serving static asset from S3',
      meta: {
        action: 'catchNonExistentStaticRoutesMiddleware',
        ...createReqMeta(req),
      },
    })
    res.status(status)
    for (const header of STATIC_ASSET_FORWARDED_HEADERS) {
      const value = headers[header]
      if (value !== undefined && value !== null) {
        res.set(header, String(value))
      }
    }
    data.pipe(res)
  } catch (err) {
    // Else return 404
    logger.error({
      message: 'Static asset not found in S3',
      meta: {
        action: 'catchNonExistentStaticRoutesMiddleware',
        ...createReqMeta(req),
      },
      // Log original error returned from s3
      error: err,
    })
    res.sendStatus(StatusCodes.NOT_FOUND)
  }
}

export const genericErrorHandlerMiddleware: ErrorRequestHandler = (
  err,
  req,
  res,
  next,
) => {
  // If headers have already been sent, don't send again
  if (res.headersSent) {
    return
  }

  // If the error object doesn't exists
  if (!err) {
    return next()
  } else {
    const genericErrorMessage =
      'Apologies, something odd happened. Please try again later!'

    const log_meta = {
      action: 'genericErrorHandlerMiddleware',
      // formId is only present for Joi validated routes that require it
      formId: get(req, 'form._id', null),
      ...createReqMeta(req),
    }

    // Error page
    if (isCelebrateError(err)) {
      logger.error({
        message: 'Joi validation error',
        meta: {
          ...log_meta,
          details: Object.fromEntries(err.details),
        },
        error: err,
      })
      return celebrateErrorHandler(err, req, res, next)
    }

    if (isBodyParserError(err)) {
      logger.error({
        message: 'Body parser error',
        meta: {
          ...log_meta,
          details: {
            type: err.type,
            message: err.message,
          },
        },
        error: err,
      })
      if (err.expose) {
        return res
          .status(err.status)
          .json({ message: err.message ?? genericErrorMessage })
      }
      return res.status(err.status).json({ message: genericErrorMessage })
    }

    if (isHTTPLikeError(err)) {
      logger.error({
        message: `HTTP Error ${err.statusCode}`,
        meta: {
          ...log_meta,
          details: {
            message: err.message,
          },
        },
        error: err,
      })
      return res.status(err.statusCode).json({ message: err.message })
    }

    // Unknown errors
    logger.error({
      message: 'Unknown error',
      meta: {
        ...log_meta,
        details: {
          message: err.message,
        },
      },
      error: err,
    })
    return res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ message: genericErrorMessage })
  }
}

export const errorHandlerMiddlewares = (): (
  | ErrorRequestHandler
  | RequestHandler
)[] => [genericErrorHandlerMiddleware, catchNonExistentStaticRoutesMiddleware]
