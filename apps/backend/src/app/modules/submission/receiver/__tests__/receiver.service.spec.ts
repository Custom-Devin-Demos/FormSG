import {
  generateNewAttachmentResponse,
  generateNewSingleAnswerResponse,
} from '__tests__/unit/backend/helpers/generate-form-data'
import Busboy from 'busboy'
import FormData from 'form-data'
import { MB } from 'formsg-shared/constants/file'
import { BasicField, FormResponseMode } from 'formsg-shared/types'
import { createReadStream, readFileSync } from 'fs'
import { IncomingHttpHeaders } from 'http'
import { omit, pick } from 'lodash'
import path from 'path'

import { fileSizeLimitBytes } from '../../submission.utils'
import {
  InitialiseMultipartReceiverError,
  MultipartError,
} from '../receiver.errors'
import * as EmailSubmissionReceiver from '../receiver.service'

jest.mock('busboy')
const MockBusboy = jest.mocked(Busboy)
const RealBusboy = jest.requireActual('busboy') as typeof Busboy

const MOCK_HEADERS: IncomingHttpHeaders = {
  'content-type': 'anything',
  key: 'value',
}

const MOCK_BUSBOY_ON = jest.fn().mockReturnThis()
const MOCK_BUSBOY = {
  on: MOCK_BUSBOY_ON,
} as unknown as Busboy.Busboy

const VALID_FILE_PATH = path.join(
  __dirname,
  '../../../../../../../../__tests__/resources',
)
const VALID_FILENAME_1 = 'valid.txt'
const VALID_FILE_CONTENT_1 = readFileSync(
  path.join(VALID_FILE_PATH, VALID_FILENAME_1),
)
const VALID_FILENAME_2 = 'valid2.txt'
const VALID_FILE_CONTENT_2 = readFileSync(
  path.join(VALID_FILE_PATH, VALID_FILENAME_2),
)
const VALID_UTF8_FILENAME = 'utf8-with-endash – test.txt'
const VALID_UTF8_FILE_CONTENT = readFileSync(
  path.join(VALID_FILE_PATH, VALID_UTF8_FILENAME),
)

describe('receiver.service', () => {
  beforeEach(() => {
    MockBusboy.mockReset()
  })
  describe('createMultipartReceiver', () => {
    describe('email submissions', () => {
      it('should call Busboy constructor with the correct params', () => {
        MockBusboy.mockReturnValueOnce(MOCK_BUSBOY)

        const result = EmailSubmissionReceiver.createMultipartReceiver(
          MOCK_HEADERS,
          FormResponseMode.Email,
        )

        expect(MockBusboy).toHaveBeenCalledWith({
          headers: MOCK_HEADERS,
          limits: {
            fieldSize: 3 * MB,
            fileSize: 7 * MB,
            files: 100,
            fields: 1,
            parts: 102,
          },
        })
        expect(result._unsafeUnwrap()).toEqual(MOCK_BUSBOY)
      })

      it('should return error headers are missing content-type key-value', () => {
        const result = EmailSubmissionReceiver.createMultipartReceiver(
          omit(MOCK_HEADERS, 'content-type'),
          FormResponseMode.Email,
        )

        // Should have failed type guard and not have been called.
        expect(MockBusboy).not.toHaveBeenCalled()
        expect(result._unsafeUnwrapErr()).toEqual(
          new InitialiseMultipartReceiverError(),
        )
      })

      it('should return error when busboy constructor errors', () => {
        MockBusboy.mockImplementationOnce(() => {
          throw new Error()
        })

        const result = EmailSubmissionReceiver.createMultipartReceiver(
          MOCK_HEADERS,
          FormResponseMode.Email,
        )

        expect(MockBusboy).toHaveBeenCalledWith({
          headers: MOCK_HEADERS,
          limits: {
            fieldSize: 3 * MB,
            fileSize: 7 * MB,
            files: 100,
            fields: 1,
            parts: 102,
          },
        })
        expect(result._unsafeUnwrapErr()).toEqual(
          new InitialiseMultipartReceiverError(),
        )
      })
    })

    describe('storage submissions', () => {
      it('should call Busboy constructor with the correct params', () => {
        MockBusboy.mockReturnValueOnce(MOCK_BUSBOY)

        const result = EmailSubmissionReceiver.createMultipartReceiver(
          MOCK_HEADERS,
          FormResponseMode.Encrypt,
        )

        expect(MockBusboy).toHaveBeenCalledWith({
          headers: MOCK_HEADERS,
          limits: {
            fieldSize: 3 * MB,
            fileSize: 20 * MB,
            files: 100,
            fields: 1,
            parts: 102,
          },
        })
        expect(result._unsafeUnwrap()).toEqual(MOCK_BUSBOY)
      })

      it('should return error headers are missing content-type key-value', () => {
        const result = EmailSubmissionReceiver.createMultipartReceiver(
          omit(MOCK_HEADERS, 'content-type'),
          FormResponseMode.Encrypt,
        )

        // Should have failed type guard and not have been called.
        expect(MockBusboy).not.toHaveBeenCalled()
        expect(result._unsafeUnwrapErr()).toEqual(
          new InitialiseMultipartReceiverError(),
        )
      })

      it('should return error when busboy constructor errors', () => {
        MockBusboy.mockImplementationOnce(() => {
          throw new Error()
        })

        const result = EmailSubmissionReceiver.createMultipartReceiver(
          MOCK_HEADERS,
          FormResponseMode.Encrypt,
        )

        expect(MockBusboy).toHaveBeenCalledWith({
          headers: MOCK_HEADERS,
          limits: {
            fieldSize: 3 * MB,
            fileSize: 20 * MB,
            files: 100,
            fields: 1,
            parts: 102,
          },
        })
        expect(result._unsafeUnwrapErr()).toEqual(
          new InitialiseMultipartReceiverError(),
        )
      })
    })
  })

  describe('configureMultipartReceiver', () => {
    describe('streaming limits', () => {
      const responseModes = [
        FormResponseMode.Email,
        FormResponseMode.Encrypt,
        FormResponseMode.Multirespondent,
      ]

      const createReceiver = (
        form: FormData,
        responseMode = FormResponseMode.Email,
      ) => {
        MockBusboy.mockImplementationOnce(RealBusboy)
        return EmailSubmissionReceiver.createMultipartReceiver(
          form.getHeaders(),
          responseMode,
        )._unsafeUnwrap()
      }

      it.each(responseModes)(
        'should abort %s submissions before EOF when aggregate file bytes exceed the limit',
        async (responseMode) => {
          const form = new FormData()
          const receiver = createReceiver(form, responseMode)
          const resultPromise =
            EmailSubmissionReceiver.configureMultipartReceiver(
              receiver,
              responseMode,
            )
          const halfLimit = fileSizeLimitBytes(responseMode) / 2
          const boundary = form.getBoundary()

          receiver.write(
            `--${boundary}\r\nContent-Disposition: form-data; name="body"\r\n\r\n{"responses":[]}\r\n` +
              `--${boundary}\r\nContent-Disposition: form-data; name="one.txt"; filename="one"\r\n\r\n`,
          )
          receiver.write(Buffer.alloc(halfLimit))
          receiver.write(
            `\r\n--${boundary}\r\nContent-Disposition: form-data; name="two.txt"; filename="two"\r\n\r\n`,
          )
          receiver.write(Buffer.alloc(halfLimit + 1))

          const result = await resultPromise
          await new Promise<void>((resolve) => setImmediate(resolve))
          expect(result._unsafeUnwrapErr()).toEqual(new MultipartError())
          expect(receiver.destroyed).toBeTrue()
          expect(receiver.writableEnded).toBeFalse()
        },
      )

      it.each(responseModes)(
        'should accept %s submissions at exactly the aggregate limit',
        async (responseMode) => {
          const form = new FormData()
          form.append('body', JSON.stringify({ responses: [] }))
          const halfLimit = fileSizeLimitBytes(responseMode) / 2
          form.append('one.txt', Buffer.alloc(halfLimit), 'one')
          form.append('two.txt', Buffer.alloc(halfLimit), 'two')
          const receiver = createReceiver(form, responseMode)
          const resultPromise =
            EmailSubmissionReceiver.configureMultipartReceiver(
              receiver,
              responseMode,
            )
          form.pipe(receiver)

          expect((await resultPromise)._unsafeUnwrap()).toEqual({
            responses: [],
          })
        },
      )

      it.each([100, 101])(
        'should enforce the file count boundary for %i files',
        async (fileCount) => {
          const form = new FormData()
          form.append('body', JSON.stringify({ responses: [] }))
          for (let i = 0; i < fileCount; i++) {
            form.append(`file-${i}.txt`, Buffer.alloc(0), `field-${i}`)
          }
          const receiver = createReceiver(form)
          const resultPromise =
            EmailSubmissionReceiver.configureMultipartReceiver(
              receiver,
              FormResponseMode.Email,
            )
          form.pipe(receiver)

          const result = await resultPromise
          expect(result.isOk()).toBe(fileCount === 100)
          expect(receiver.destroyed).toBeTrue()
        },
      )

      it.each(['body', 'unexpected'])(
        'should reject an additional %s field',
        async (fieldName) => {
          const form = new FormData()
          form.append('body', JSON.stringify({ responses: [] }))
          form.append(fieldName, JSON.stringify({ responses: [] }))
          const receiver = createReceiver(form)
          const resultPromise =
            EmailSubmissionReceiver.configureMultipartReceiver(
              receiver,
              FormResponseMode.Email,
            )
          form.pipe(receiver)

          expect((await resultPromise)._unsafeUnwrapErr()).toEqual(
            new MultipartError(),
          )
          expect(receiver.destroyed).toBeTrue()
        },
      )

      it('should reject truncated fields even when they are not the body', async () => {
        const form = new FormData()
        form.append('unexpected', 'a'.repeat(3 * MB + 1))
        const receiver = createReceiver(form)
        const resultPromise =
          EmailSubmissionReceiver.configureMultipartReceiver(
            receiver,
            FormResponseMode.Email,
          )
        form.pipe(receiver)

        expect((await resultPromise)._unsafeUnwrapErr()).toEqual(
          new MultipartError(),
        )
        expect(receiver.destroyed).toBeTrue()
      })

      it('should abort when Busboy emits a parts limit', async () => {
        const form = new FormData()
        form.append('body', JSON.stringify({ responses: [] }))
        form.append('one.txt', Buffer.alloc(0), 'one')
        const receiver = RealBusboy({
          headers: form.getHeaders(),
          limits: { parts: 2 },
        })
        const resultPromise =
          EmailSubmissionReceiver.configureMultipartReceiver(
            receiver,
            FormResponseMode.Email,
          )
        form.pipe(receiver)

        expect((await resultPromise)._unsafeUnwrapErr()).toEqual(
          new MultipartError(),
        )
        expect(receiver.destroyed).toBeTrue()
      })

      it('should count and consume file parts without a filename', async () => {
        const form = new FormData()
        const receiver = createReceiver(form)
        const resultPromise =
          EmailSubmissionReceiver.configureMultipartReceiver(
            receiver,
            FormResponseMode.Email,
          )
        const boundary = form.getBoundary()
        receiver.write(
          `--${boundary}\r\nContent-Disposition: form-data; name="body"\r\n\r\n{"responses":[]}\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="ignored"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        )
        receiver.write(Buffer.alloc(4 * MB))
        receiver.write(
          `\r\n--${boundary}\r\nContent-Disposition: form-data; name="one.txt"; filename="one"\r\n\r\n`,
        )
        receiver.write(Buffer.alloc(3 * MB + 1))

        expect((await resultPromise)._unsafeUnwrapErr()).toEqual(
          new MultipartError(),
        )
        expect(receiver.destroyed).toBeTrue()
      })

      it('should consume an empty filename without stalling valid submissions', async () => {
        const form = new FormData()
        const receiver = createReceiver(form)
        const resultPromise =
          EmailSubmissionReceiver.configureMultipartReceiver(
            receiver,
            FormResponseMode.Email,
          )
        const boundary = form.getBoundary()
        receiver.end(
          `--${boundary}\r\nContent-Disposition: form-data; name="ignored"; filename=""\r\nContent-Type: application/octet-stream\r\n\r\nignored\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="body"\r\n\r\n{"responses":[]}\r\n--${boundary}--\r\n`,
        )

        expect((await resultPromise)._unsafeUnwrap()).toEqual({ responses: [] })
      })
    })

    it('should correctly process and return with utf8 file names', async () => {
      const mockResponse = pick(generateNewAttachmentResponse(), [
        '_id',
        'question',
        'answer',
        'fieldType',
      ])
      const mockBody = { responses: [mockResponse] }

      const fileStream = createReadStream(
        path.join(VALID_FILE_PATH, VALID_UTF8_FILENAME),
      )
      const form = new FormData()
      form.append('body', JSON.stringify(mockBody))
      form.append(VALID_UTF8_FILENAME, fileStream, mockResponse._id)
      const realBusboy = RealBusboy({
        headers: {
          'content-type': `multipart/form-data; boundary=${form.getBoundary()}`,
        },
      })
      const resultPromise = EmailSubmissionReceiver.configureMultipartReceiver(
        realBusboy,
        FormResponseMode.Email,
      )
      form.pipe(realBusboy)

      fileStream.emit('data', VALID_UTF8_FILE_CONTENT)
      fileStream.emit('end')
      form.emit('end')

      const result = await resultPromise
      expect(result._unsafeUnwrap()).toEqual({
        responses: [
          {
            _id: mockResponse._id,
            question: mockResponse.question,
            answer: VALID_UTF8_FILENAME,
            fieldType: mockResponse.fieldType,
            filename: VALID_UTF8_FILENAME,
            content: Buffer.concat([VALID_UTF8_FILE_CONTENT]),
          },
        ],
      })
    })

    it('should receive a single attachment and add it to the response', async () => {
      const mockResponse = pick(generateNewAttachmentResponse(), [
        '_id',
        'question',
        'answer',
        'fieldType',
      ])
      const mockBody = { responses: [mockResponse] }

      const fileStream = createReadStream(
        path.join(VALID_FILE_PATH, VALID_FILENAME_1),
      )
      const form = new FormData()
      form.append('body', JSON.stringify(mockBody))
      form.append(VALID_FILENAME_1, fileStream, mockResponse._id)
      const realBusboy = RealBusboy({
        headers: {
          'content-type': `multipart/form-data; boundary=${form.getBoundary()}`,
        },
      })
      const resultPromise = EmailSubmissionReceiver.configureMultipartReceiver(
        realBusboy,
        FormResponseMode.Email,
      )
      form.pipe(realBusboy)

      fileStream.emit('data', VALID_FILE_CONTENT_1)
      fileStream.emit('end')
      form.emit('end')

      const result = await resultPromise
      expect(result._unsafeUnwrap()).toEqual({
        responses: [
          {
            _id: mockResponse._id,
            question: mockResponse.question,
            answer: VALID_FILENAME_1,
            fieldType: mockResponse.fieldType,
            filename: VALID_FILENAME_1,
            content: Buffer.concat([VALID_FILE_CONTENT_1]),
          },
        ],
      })
    })

    it('should receive a mix of attachment and non-attachment responses', async () => {
      const mockAttachment = pick(generateNewAttachmentResponse(), [
        '_id',
        'question',
        'answer',
        'fieldType',
      ])
      const mockTextField = pick(
        generateNewSingleAnswerResponse(BasicField.ShortText),
        ['_id', 'question', 'answer', 'fieldType'],
      )
      const mockBody = { responses: [mockAttachment, mockTextField] }

      const fileStream = createReadStream(
        path.join(VALID_FILE_PATH, VALID_FILENAME_1),
      )
      const form = new FormData()
      form.append('body', JSON.stringify(mockBody))
      form.append(VALID_FILENAME_1, fileStream, mockAttachment._id)
      const realBusboy = RealBusboy({
        headers: {
          'content-type': `multipart/form-data; boundary=${form.getBoundary()}`,
        },
      })
      const resultPromise = EmailSubmissionReceiver.configureMultipartReceiver(
        realBusboy,
        FormResponseMode.Email,
      )
      form.pipe(realBusboy)

      fileStream.emit('data', VALID_FILE_CONTENT_1)
      fileStream.emit('end')
      form.emit('end')

      const result = await resultPromise
      expect(result._unsafeUnwrap()).toEqual({
        responses: [
          {
            _id: mockAttachment._id,
            question: mockAttachment.question,
            answer: VALID_FILENAME_1,
            fieldType: mockAttachment.fieldType,
            filename: VALID_FILENAME_1,
            content: Buffer.concat([VALID_FILE_CONTENT_1]),
          },
          {
            _id: mockTextField._id,
            question: mockTextField.question,
            answer: mockTextField.answer,
            fieldType: mockTextField.fieldType,
          },
        ],
      })
    })

    it('should receive multiple attachments and add them to responses', async () => {
      const mockResponse1 = pick(
        generateNewAttachmentResponse({
          question: 'Question 1',
          answer: VALID_FILENAME_1,
        }),
        ['_id', 'question', 'answer', 'fieldType'],
      )
      const mockResponse2 = pick(
        generateNewAttachmentResponse({
          question: 'Question 2',
          answer: VALID_FILENAME_2,
        }),
        ['_id', 'question', 'answer', 'fieldType'],
      )
      const mockBody = { responses: [mockResponse1, mockResponse2] }

      const fileStream1 = createReadStream(
        path.join(VALID_FILE_PATH, VALID_FILENAME_1),
      )
      const fileStream2 = createReadStream(
        path.join(VALID_FILE_PATH, VALID_FILENAME_2),
      )
      const form = new FormData()
      form.append('body', JSON.stringify(mockBody))
      form.append(VALID_FILENAME_1, fileStream1, mockResponse1._id)
      form.append(VALID_FILENAME_2, fileStream2, mockResponse2._id)
      const realBusboy = RealBusboy({
        headers: {
          'content-type': `multipart/form-data; boundary=${form.getBoundary()}`,
        },
      })
      const resultPromise = EmailSubmissionReceiver.configureMultipartReceiver(
        realBusboy,
        FormResponseMode.Email,
      )
      form.pipe(realBusboy)

      fileStream1.emit('data', VALID_FILE_CONTENT_1)
      fileStream1.emit('end')
      fileStream2.emit('data', VALID_FILE_CONTENT_2)
      fileStream2.emit('end')
      form.emit('end')

      const result = await resultPromise
      expect(result._unsafeUnwrap()).toEqual({
        responses: [
          {
            _id: mockResponse1._id,
            question: mockResponse1.question,
            answer: VALID_FILENAME_1,
            fieldType: mockResponse1.fieldType,
            filename: VALID_FILENAME_1,
            content: Buffer.concat([VALID_FILE_CONTENT_1]),
          },
          {
            _id: mockResponse2._id,
            question: mockResponse2.question,
            answer: VALID_FILENAME_2,
            fieldType: mockResponse2.fieldType,
            filename: VALID_FILENAME_2,
            content: Buffer.concat([VALID_FILE_CONTENT_2]),
          },
        ],
      })
    })

    it('should de-duplicate identical attachment filenames', async () => {
      const mockResponse1 = pick(
        generateNewAttachmentResponse({
          question: 'Question 1',
          answer: VALID_FILENAME_1,
        }),
        ['_id', 'question', 'answer', 'fieldType'],
      )
      const mockResponse2 = pick(
        generateNewAttachmentResponse({
          question: 'Question 2',
          answer: VALID_FILENAME_2,
        }),
        ['_id', 'question', 'answer', 'fieldType'],
      )
      const mockBody = { responses: [mockResponse1, mockResponse2] }

      const fileStream1 = createReadStream(
        path.join(VALID_FILE_PATH, VALID_FILENAME_1),
      )
      const fileStream2 = createReadStream(
        path.join(VALID_FILE_PATH, VALID_FILENAME_1),
      )
      const form = new FormData()
      form.append('body', JSON.stringify(mockBody))
      form.append(VALID_FILENAME_1, fileStream1, mockResponse1._id)
      form.append(VALID_FILENAME_1, fileStream2, mockResponse2._id)
      const realBusboy = RealBusboy({
        headers: {
          'content-type': `multipart/form-data; boundary=${form.getBoundary()}`,
        },
      })
      const resultPromise = EmailSubmissionReceiver.configureMultipartReceiver(
        realBusboy,
        FormResponseMode.Email,
      )
      form.pipe(realBusboy)

      fileStream1.emit('data', VALID_FILE_CONTENT_1)
      fileStream1.emit('end')
      fileStream2.emit('data', VALID_FILE_CONTENT_1)
      fileStream2.emit('end')
      form.emit('end')

      const result = await resultPromise
      expect(result._unsafeUnwrap()).toEqual({
        responses: [
          {
            _id: mockResponse1._id,
            question: mockResponse1.question,
            answer: `1-${VALID_FILENAME_1}`,
            fieldType: mockResponse1.fieldType,
            filename: `1-${VALID_FILENAME_1}`,
            content: Buffer.concat([VALID_FILE_CONTENT_1]),
          },
          {
            _id: mockResponse2._id,
            question: mockResponse2.question,
            answer: VALID_FILENAME_1,
            fieldType: mockResponse2.fieldType,
            filename: VALID_FILENAME_1,
            content: Buffer.concat([VALID_FILE_CONTENT_1]),
          },
        ],
      })
    })

    it('should return MultipartError when file limit is reached', async () => {
      const mockResponse = pick(generateNewAttachmentResponse(), [
        '_id',
        'question',
        'answer',
        'fieldType',
      ])
      const mockBody = { responses: [mockResponse] }

      const fileStream = createReadStream(
        path.join(VALID_FILE_PATH, VALID_FILENAME_1),
      )
      const form = new FormData()
      form.append('body', JSON.stringify(mockBody))
      form.append(VALID_FILENAME_1, fileStream, mockResponse._id)
      const realBusboy = RealBusboy({
        headers: {
          'content-type': `multipart/form-data; boundary=${form.getBoundary()}`,
        },
        limits: {
          fieldSize: 3 * MB,
          fileSize: 7 * MB,
        },
      })
      const resultPromise = EmailSubmissionReceiver.configureMultipartReceiver(
        realBusboy,
        FormResponseMode.Email,
      )
      form.pipe(realBusboy)

      fileStream.emit('data', Buffer.alloc(7 * MB + 1))

      const result = await resultPromise
      expect(result._unsafeUnwrapErr()).toEqual(new MultipartError())
    })

    it('should return MultipartError when error event is emitted', async () => {
      const mockBody = { responses: [] }

      const form = new FormData()
      form.append('body', JSON.stringify(mockBody))
      const realBusboy = RealBusboy({
        headers: {
          'content-type': `multipart/form-data; boundary=${form.getBoundary()}`,
        },
      })
      const resultPromise = EmailSubmissionReceiver.configureMultipartReceiver(
        realBusboy,
        FormResponseMode.Email,
      )
      form.pipe(realBusboy)

      realBusboy.emit('error', new Error())

      const result = await resultPromise
      expect(result._unsafeUnwrapErr()).toEqual(new MultipartError())
    })

    it('should return MultipartError when body cannot be parsed', async () => {
      const form = new FormData()
      form.append('body', 'invalid')
      const realBusboy = RealBusboy({
        headers: {
          'content-type': `multipart/form-data; boundary=${form.getBoundary()}`,
        },
      })
      const resultPromise = EmailSubmissionReceiver.configureMultipartReceiver(
        realBusboy,
        FormResponseMode.Email,
      )
      form.pipe(realBusboy)
      form.emit('end')

      const result = await resultPromise
      expect(result._unsafeUnwrapErr()).toEqual(new MultipartError())
    })
  })
})
