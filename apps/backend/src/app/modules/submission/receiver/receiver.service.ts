import type { FieldResponsesV4 } from '@opengovsg/formsg-sdk'
import Busboy from 'busboy'
import { MB } from 'formsg-shared/constants/file'
import { FieldResponse, FormResponseMode } from 'formsg-shared/types'
import { IncomingHttpHeaders } from 'http'
import { err, ok, Result, ResultAsync } from 'neverthrow'

import { IAttachmentInfo } from '../../../../types'
import { createLoggerWithLabel } from '../../../config/logger'
import { fileSizeLimitBytes } from '../submission.utils'

import {
  InitialiseMultipartReceiverError,
  MultipartContentLimitError,
  MultipartContentParsingError,
  MultipartError,
} from './receiver.errors'
import { ParsedMultipartForm } from './receiver.types'
import {
  adaptMrfV3BodyToV4,
  addAttachmentToResponses,
  handleDuplicatesInAttachments,
} from './receiver.utils'

const logger = createLoggerWithLabel(module)

const MAX_MULTIPART_FILES = 100
const MAX_MULTIPART_FIELDS = 1

const hasContentTypeHeaders = (headers: IncomingHttpHeaders) => {
  return !!headers['content-type']
}

/**
 * Initialises a Busboy object to receive the submission stream
 * @param headers HTTP request headers
 */
export const createMultipartReceiver = (
  headers: IncomingHttpHeaders,
  responseMode: FormResponseMode,
): Result<Busboy.Busboy, InitialiseMultipartReceiverError> => {
  if (!hasContentTypeHeaders(headers)) {
    logger.error({
      message: "Busboy cannot be init due to missing headers['content-type']",
      meta: {
        action: 'createMultipartReceiver',
        headers,
      },
    })
    return err(new InitialiseMultipartReceiverError())
  }

  try {
    const busboy = Busboy({
      headers,
      limits: {
        fieldSize: 3 * MB,
        fileSize: fileSizeLimitBytes(responseMode),
        files: MAX_MULTIPART_FILES,
        fields: MAX_MULTIPART_FIELDS,
        // Busboy emits partsLimit when the count reaches, not exceeds, this limit.
        parts: MAX_MULTIPART_FILES + MAX_MULTIPART_FIELDS + 1,
      },
    })
    return ok(busboy)
  } catch (error) {
    logger.error({
      message: 'Error while initialising busboy',
      meta: {
        action: 'createMultipartReceiver',
        headers,
      },
      error,
    })
    return err(new InitialiseMultipartReceiverError())
  }
}

/**
 * Parses the incoming submission stream into responses together with
 * attachment content for attachment fields.
 * @param busboy Busboy receiver object
 */
export const configureMultipartReceiver = (
  busboy: Busboy.Busboy,
  responseMode: FormResponseMode,
): ResultAsync<
  ParsedMultipartForm<FieldResponse[] | FieldResponsesV4>,
  MultipartError
> => {
  const logMeta = {
    action: 'configureMultipartReceiver',
  }
  const responsePromise = new Promise<
    ParsedMultipartForm<FieldResponse[] | FieldResponsesV4>
  >((resolve, reject) => {
    const attachments: IAttachmentInfo[] = []
    const pendingBuffers = new Set<Buffer[]>()
    const totalSizeLimit = fileSizeLimitBytes(responseMode)
    let totalSize = 0
    let failed = false
    let body:
      | ParsedMultipartForm<FieldResponse[] | FieldResponsesV4>
      | undefined

    const fail = (error: Error) => {
      if (failed) return
      failed = true
      attachments.length = 0
      for (const buffers of pendingBuffers) buffers.length = 0
      pendingBuffers.clear()
      body = undefined
      reject(error)
      // Avoid destroying Busboy reentrantly from its synchronous parser callbacks.
      queueMicrotask(() => busboy.destroy(error))
    }

    const onLimit = () => {
      if (failed) return
      logger.error({
        message: 'Limit event triggered by multipart receiver',
        meta: logMeta,
      })
      fail(new MultipartContentLimitError())
    }

    busboy
      .on('file', (fieldname, file, { filename }) => {
        file.on('error', fail)
        if (failed) {
          file.resume()
          return
        }
        // Required to convert fieldname's encoding as busboy treats all
        // incoming fields as `latin1` encoding,
        // but this means some file languages gets incorrectly encoded
        // (like Chinese, Tamil, etc), e.g.
        // `utf8-with-endash – test.txt` -> `utf8-with-endash â�� test.txt`.
        // See https://github.com/mscdex/busboy/issues/274.
        if (!fieldname) {
          logger.error({
            message: 'Error while attempting to parse form fieldname',
            meta: logMeta,
          })
          file.resume()
          return fail(new MultipartContentParsingError())
        }
        const utf8Fieldname = Buffer.from(fieldname, 'latin1').toString('utf8')
        const buffers: Buffer[] = []
        pendingBuffers.add(buffers)
        file.on('data', (data: Buffer) => {
          if (failed) return
          totalSize += data.length
          if (totalSize > totalSizeLimit) return onLimit()
          if (filename) buffers.push(data)
        })

        file.on('end', () => {
          if (failed) return
          if (filename) {
            const buffer = Buffer.concat(buffers)
            attachments.push({
              filename: utf8Fieldname,
              content: buffer,
              fieldId: filename,
            })
          }
          buffers.length = 0
          pendingBuffers.delete(buffers)
        })
        file.on('limit', onLimit)
      })
      .on('filesLimit', onLimit)
      .on('fieldsLimit', onLimit)
      .on('partsLimit', onLimit)
      .on('field', (name, val, { valueTruncated }) => {
        if (failed) return
        if (valueTruncated) return onLimit()
        // on receiving body field, convert to JSON
        if (name === 'body') {
          try {
            body = JSON.parse(val)
          } catch (error) {
            // Invalid form data
            logger.error({
              message: 'Error while attempting to parse form data',
              meta: logMeta,
              error,
            })
            return fail(new MultipartContentParsingError())
          }
        }
      })
      .on('error', (error: Error) => {
        if (failed) return
        logger.error({
          message: 'Generic multipart error',
          meta: logMeta,
          error,
        })
        return fail(error)
      })
      .on('close', () => {
        if (failed) return
        if (body) {
          adaptMrfV3BodyToV4(body)
          handleDuplicatesInAttachments(attachments)
          addAttachmentToResponses(body, attachments)
          return resolve(body)
        } else {
          // if body is not defined, the Promise would have been rejected elsewhere.
          // but reject here again just in case.
          return reject(new MultipartError())
        }
      })
  })
  return ResultAsync.fromPromise(responsePromise, (error) => {
    logger.error({
      message: 'Error while receiving form data',
      meta: logMeta,
      error,
    })
    return new MultipartError()
  })
}
