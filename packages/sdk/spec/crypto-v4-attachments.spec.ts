import mockAxios from 'jest-mock-axios'

import formsg, { FieldResponsesV4 } from '../src'
import Crypto from '../src/crypto'
import CryptoV4 from '../src/crypto-v4'
import { MissingPublicKeyError } from '../src/errors'
import { SIGNING_KEYS } from '../src/resource/signing-keys'

jest.mock('axios', () => mockAxios)

const { cryptoV3, cryptoV4 } = formsg({ mode: 'test' })
const responses: FieldResponsesV4 = {
  attachment: {
    fieldType: 'attachment',
    question: 'Evidence',
    answer: { value: 'evidence.txt', hasBeenScanned: true },
    provenance: { stepNumber: 0 },
  },
}

afterEach(() => mockAxios.reset())

const encryptedDownload = async (bytes: Uint8Array, publicKey: string) => {
  const file = await cryptoV4.encryptFile(bytes, publicKey)
  return {
    data: {
      encryptedFile: {
        ...file,
        binary: Buffer.from(file.binary).toString('base64'),
      },
    },
  }
}

it('returns null when a V4 webhook attachment belongs to another submission', async () => {
  // Prepare: encrypt the attachment with a different submission public key.
  const keys = cryptoV4.generate()
  const encrypted = cryptoV4.encrypt(responses, keys.publicKey)
  const otherSubmission = cryptoV4.encrypt(responses, keys.publicKey)
  const download = await encryptedDownload(
    new Uint8Array([1, 2, 3]),
    otherSubmission.submissionPublicKey
  )

  // Act: decrypt the V4 webhook and complete the attachment downloads.
  const result = cryptoV4.decryptWithAttachments(keys.secretKey, {
    ...encrypted,
    version: 4,
    attachmentDownloadUrls: {
      attachment:
        'https://formsg-attachments.s3.ap-southeast-1.amazonaws.com/evidence',
    },
  })
  mockAxios.mockResponseFor(
    'https://formsg-attachments.s3.ap-southeast-1.amazonaws.com/evidence',
    download
  )

  // Assert: attachment decryption failure returns null for the whole webhook.
  await expect(result).resolves.toBeNull()
})

it('returns null for the V4 webhook when any attachment cannot be decrypted', async () => {
  // Prepare: one attachment uses the submission key and the other uses an unrelated key.
  const keys = cryptoV4.generate()
  const encrypted = cryptoV4.encrypt(
    {
      ...responses,
      other: {
        ...responses.attachment,
        answer: { value: 'other.txt', hasBeenScanned: true },
      },
    },
    keys.publicKey
  )
  const successfulDownload = await encryptedDownload(
    new Uint8Array([1, 2, 3]),
    encrypted.submissionPublicKey
  )
  const failedDownload = await encryptedDownload(
    new Uint8Array([4, 5, 6]),
    cryptoV4.generate().publicKey
  )

  // Act: decrypt the V4 webhook and complete the attachment downloads.
  const result = cryptoV4.decryptWithAttachments(keys.secretKey, {
    ...encrypted,
    version: 4,
    attachmentDownloadUrls: {
      attachment:
        'https://formsg-attachments.s3.ap-southeast-1.amazonaws.com/evidence',
      other: 'https://formsg-attachments.s3.ap-southeast-1.amazonaws.com/other',
    },
  })
  mockAxios.mockResponseFor(
    'https://formsg-attachments.s3.ap-southeast-1.amazonaws.com/evidence',
    successfulDownload
  )
  mockAxios.mockResponseFor(
    'https://formsg-attachments.s3.ap-southeast-1.amazonaws.com/other',
    failedDownload
  )

  // Assert: attachment decryption failure returns null for the whole webhook.
  await expect(result).resolves.toBeNull()
})

it('rejects V4 webhook decryption when verified content has no configured signing public key', async () => {
  // Prepare: signed verified content and an SDK instance without a signing public key.
  const crypto = new CryptoV4()
  const keys = crypto.generate()
  const encrypted = crypto.encrypt(responses, keys.publicKey)
  const verifiedContent = new Crypto().encrypt(
    { uinFin: 'S1234567A' },
    encrypted.submissionPublicKey,
    SIGNING_KEYS.test.secretKey
  )

  // Act: decrypt the V4 webhook containing signed verified content.
  const result = crypto.decryptWithAttachments(keys.secretKey, {
    ...encrypted,
    version: 4,
    verifiedContent,
  })

  // Assert: missing signing configuration rejects instead of returning null.
  await expect(result).rejects.toThrow(MissingPublicKeyError)
})

it('returns V4 webhook attachments with their field IDs, filenames and file contents', async () => {
  // Prepare: two attachment responses with distinct filenames and file contents.
  const keys = cryptoV4.generate()
  const encrypted = cryptoV4.encrypt(
    {
      ...responses,
      other: {
        ...responses.attachment,
        answer: { value: 'other.txt', hasBeenScanned: true },
      },
    },
    keys.publicKey
  )
  const evidenceBytes = new Uint8Array([1, 2, 3])
  const otherBytes = new Uint8Array([4, 5, 6])
  const evidenceDownload = await encryptedDownload(
    evidenceBytes,
    encrypted.submissionPublicKey
  )
  const otherDownload = await encryptedDownload(
    otherBytes,
    encrypted.submissionPublicKey
  )

  // Act: decrypt the V4 webhook and complete the attachment downloads.
  const result = cryptoV4.decryptWithAttachments(keys.secretKey, {
    ...encrypted,
    version: 4,
    attachmentDownloadUrls: {
      attachment:
        'https://formsg-attachments.s3.ap-southeast-1.amazonaws.com/evidence',
      other: 'https://formsg-attachments.s3.ap-southeast-1.amazonaws.com/other',
    },
  })
  mockAxios.mockResponseFor(
    'https://formsg-attachments.s3.ap-southeast-1.amazonaws.com/other',
    otherDownload
  )
  mockAxios.mockResponseFor(
    'https://formsg-attachments.s3.ap-southeast-1.amazonaws.com/evidence',
    evidenceDownload
  )

  // Assert: reversed download completion preserves each field's filename and file contents.
  expect((await result)?.attachments).toEqual({
    attachment: { filename: 'evidence.txt', content: evidenceBytes },
    other: { filename: 'other.txt', content: otherBytes },
  })
})

it('decrypts V4 webhook responses and attachments with the form secret key', async () => {
  // Prepare: responses and an attachment encrypted with the same submission key.
  const keys = cryptoV3.generate()
  const encrypted = cryptoV3.encrypt(responses, keys.publicKey)
  const bytes = new Uint8Array([104, 101, 108, 108, 111])
  const file = await cryptoV3.encryptFile(bytes, encrypted.submissionPublicKey)

  // Act: decrypt the V4 webhook and complete the attachment downloads.
  const result = cryptoV4.decryptWithAttachments(keys.secretKey, {
    ...encrypted,
    version: 4,
    attachmentDownloadUrls: {
      attachment:
        'https://formsg-attachments.s3.ap-southeast-1.amazonaws.com/evidence',
    },
  })
  mockAxios.mockResponse({
    data: {
      encryptedFile: {
        ...file,
        binary: Buffer.from(file.binary).toString('base64'),
      },
    },
  })
  // Assert: recover the submitted responses, filename and original file contents.
  await expect(result).resolves.toMatchObject({
    content: { responses },
    attachments: { attachment: { filename: 'evidence.txt', content: bytes } },
  })
})

it.each([
  'incorrect form secret key',
  'unknown attachment field ID',
  'attachment download failure',
  'malformed attachment envelope',
])(
  'returns null for both Legacy (V1) and V4 webhooks on %s',
  async (scenario) => {
    // Prepare: equivalent Legacy (V1) and V4 webhooks with the same failure condition.
    const { crypto } = formsg({ mode: 'test' })
    const keys = crypto.generate()
    const v4 = cryptoV3.encrypt(responses, keys.publicKey)
    const v1 = crypto.encrypt(
      [
        {
          _id: 'attachment',
          fieldType: 'attachment',
          question: 'Evidence',
          answer: 'evidence.txt',
        },
      ],
      keys.publicKey
    )
    const attachmentDownloadUrls = {
      [scenario === 'unknown attachment field ID' ? 'unknown' : 'attachment']:
        'https://formsg-attachments.s3.ap-southeast-1.amazonaws.com/evidence',
    }
    const secretKey =
      scenario === 'incorrect form secret key'
        ? crypto.generate().secretKey
        : keys.secretKey

    // Act: decrypt both webhook formats and complete any failed downloads.
    const legacy = crypto.decryptWithAttachments(secretKey, {
      encryptedContent: v1,
      version: 1,
      attachmentDownloadUrls,
    })
    const native = cryptoV4.decryptWithAttachments(secretKey, {
      ...v4,
      version: 4,
      attachmentDownloadUrls,
    })
    if (scenario === 'attachment download failure') {
      mockAxios.mockError(new Error('unavailable'))
      mockAxios.mockError(new Error('unavailable'))
    }
    if (scenario === 'malformed attachment envelope') {
      mockAxios.mockResponse({ data: {} })
      mockAxios.mockResponse({ data: {} })
    }
    const [legacyResult, nativeResult] = await Promise.all([legacy, native])

    // Assert: both webhook formats return null under the same failure condition.
    expect(legacyResult).toBeNull()
    expect(nativeResult).toBeNull()
  }
)

it('returns V4 webhook responses with no attachments when download URLs are omitted', async () => {
  // Prepare: an attachment response without any attachment download URLs.
  const keys = cryptoV3.generate()
  const encrypted = cryptoV3.encrypt(responses, keys.publicKey)

  // Act: decrypt the V4 webhook without requesting attachment downloads.
  const result = await cryptoV4.decryptWithAttachments(keys.secretKey, {
    ...encrypted,
    version: 4,
  })

  // Assert: retain the content-and-attachments result shape with responses and an empty attachment map.
  expect(Object.keys(result!).sort()).toEqual(['attachments', 'content'])
  expect(result!.attachments).toEqual({})
  expect(result!.content.responses).toEqual(responses)
})

it('returns null when a V4 webhook attachment response has no filename', async () => {
  // Prepare: a download URL whose attachment response has a null answer.
  const keys = cryptoV3.generate()
  const encrypted = cryptoV3.encrypt(
    { attachment: { ...responses.attachment, answer: null } },
    keys.publicKey
  )

  // Act: decrypt the V4 webhook with the attachment download URL.
  const result = cryptoV4.decryptWithAttachments(keys.secretKey, {
    ...encrypted,
    version: 4,
    attachmentDownloadUrls: {
      attachment:
        'https://formsg-attachments.s3.ap-southeast-1.amazonaws.com/evidence',
    },
  })

  // Assert: an attachment without a filename makes the whole result null.
  await expect(result).resolves.toBeNull()
})

describe('attachment download URL validation', () => {
  const decryptWithUrl = async (url: string, sdk: CryptoV4 = cryptoV4) => {
    const keys = sdk.generate()
    const encrypted = sdk.encrypt(responses, keys.publicKey)
    return sdk.decryptWithAttachments(keys.secretKey, {
      ...encrypted,
      version: 4,
      attachmentDownloadUrls: { attachment: url },
    })
  }

  it.each([
    'http://formsg-attachments.s3.ap-southeast-1.amazonaws.com/evidence',
    'http://169.254.169.254/latest/meta-data/',
    'https://169.254.169.254/latest/meta-data/',
    'https://localhost/evidence',
    'https://files.example/evidence',
    'https://s3.amazonaws.com.attacker.example/evidence',
    'https://formsg-attachments.s3.ap-southeast-1.amazonaws.com:8443/evidence',
    'https://user:pass@formsg-attachments.s3.ap-southeast-1.amazonaws.com/evidence',
    'file:///etc/passwd',
    'not a url',
  ])('returns null without downloading from %s', async (url) => {
    // Act: decrypt a webhook whose attachment URL is not an allowed S3 https URL.
    const result = await decryptWithUrl(url)

    // Assert: no request is made and the whole result is null.
    expect(result).toBeNull()
    expect(mockAxios.get).not.toHaveBeenCalled()
  })

  it('downloads with redirects disabled and timeout and size limits', async () => {
    // Prepare: an allowed S3 URL.
    const url = 'https://formsg-attachments.s3.ap-southeast-1.amazonaws.com/a'

    // Act: decrypt the webhook and fail the download.
    const result = decryptWithUrl(url)
    mockAxios.mockError(new Error('unavailable'))
    await result

    // Assert: the request is bounded and does not follow redirects.
    expect(mockAxios.get).toHaveBeenCalledWith(url, {
      responseType: 'json',
      maxRedirects: 0,
      timeout: 30000,
      maxContentLength: 32 * 1024 * 1024,
    })
  })

  it('only downloads from caller-configured hosts when allowedHosts is set', async () => {
    // Prepare: an SDK restricted to a custom host and its subdomains.
    const sdk = new CryptoV4({
      attachmentDownloadOptions: {
        allowedHosts: ['files.example', '*.cdn.example'],
        timeout: 1000,
        maxContentLength: 2048,
      },
    })

    // Act + Assert: S3 hosts are no longer allowed by default.
    await expect(
      decryptWithUrl(
        'https://formsg-attachments.s3.ap-southeast-1.amazonaws.com/a',
        sdk
      )
    ).resolves.toBeNull()
    expect(mockAxios.get).not.toHaveBeenCalled()

    // Act: decrypt webhooks pointing at allowed custom hosts.
    const exact = decryptWithUrl('https://files.example/a', sdk)
    const wildcard = decryptWithUrl('https://eu.cdn.example/a', sdk)
    mockAxios.mockError(new Error('unavailable'))
    mockAxios.mockError(new Error('unavailable'))
    await Promise.all([exact, wildcard])

    // Assert: both are fetched with the configured limits.
    const config = {
      responseType: 'json',
      maxRedirects: 0,
      timeout: 1000,
      maxContentLength: 2048,
    }
    expect(mockAxios.get).toHaveBeenCalledWith(
      'https://files.example/a',
      config
    )
    expect(mockAxios.get).toHaveBeenCalledWith(
      'https://eu.cdn.example/a',
      config
    )
  })

  it.each([
    'https://formsg-attachments.s3.amazonaws.com/a',
    'https://s3.ap-southeast-1.amazonaws.com/formsg-attachments/a',
    'https://formsg-attachments.s3-ap-southeast-1.amazonaws.com/a',
    'https://formsg-attachments.s3.dualstack.us-gov-west-1.amazonaws.com/a',
  ])('downloads from S3 host %s by default', async (url) => {
    // Act: decrypt the webhook and fail the download.
    const result = decryptWithUrl(url)
    mockAxios.mockError(new Error('unavailable'))
    await result

    // Assert: the S3 URL is fetched.
    expect(mockAxios.get).toHaveBeenCalledWith(url, expect.anything())
  })
})
