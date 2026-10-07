import axios from 'axios'
import nacl from 'tweetnacl'

import {
  areAttachmentFieldIdsValid,
  convertEncryptedAttachmentToFileContent,
  generateKeypair,
} from './util/crypto'
import { decodeBase64, encodeBase64 } from './util/encoding'
import { AttachmentDecryptionError } from './errors'
import {
  AttachmentDownloadOptions,
  DecryptedAttachments,
  EncryptedAttachmentContent,
  EncryptedAttachmentRecords,
  EncryptedFileContent,
} from './types'

const DEFAULT_ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 30_000
// Fits the largest (20MB) attachment after base64 and JSON envelope overhead.
const DEFAULT_ATTACHMENT_MAX_CONTENT_LENGTH = 32 * 1024 * 1024
// Amazon S3 endpoints, e.g. bucket.s3.ap-southeast-1.amazonaws.com
const S3_HOSTNAME_REGEX =
  /^(?:[a-z0-9][a-z0-9.-]*\.)?s3(?:-accelerate)?(?:\.dualstack)?(?:[.-][a-z]{2}(?:-gov)?-[a-z]+-\d+)?\.amazonaws\.com$/

const isAllowedHost = (hostname: string, allowedHosts?: string[]): boolean => {
  if (!allowedHosts) return S3_HOSTNAME_REGEX.test(hostname)
  return allowedHosts.some((entry) => {
    const allowed = entry.toLowerCase()
    return allowed.startsWith('*.')
      ? hostname.endsWith(allowed.slice(1))
      : hostname === allowed
  })
}

/**
 * Attachment download URLs arrive unauthenticated in the webhook body, so only
 * fetch https URLs on the default port from allowed hosts.
 */
const isAllowedAttachmentUrl = (
  url: string,
  allowedHosts?: string[]
): boolean => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return (
    parsed.protocol === 'https:' &&
    parsed.port === '' &&
    parsed.username === '' &&
    parsed.password === '' &&
    isAllowedHost(parsed.hostname.toLowerCase(), allowedHosts)
  )
}

export default class CryptoBase {
  protected readonly attachmentDownloadOptions: AttachmentDownloadOptions

  constructor(attachmentDownloadOptions: AttachmentDownloadOptions = {}) {
    this.attachmentDownloadOptions = attachmentDownloadOptions
  }

  protected decryptAttachments = async (
    secretKey: string,
    urls: EncryptedAttachmentRecords,
    filenames: Record<string, string>
  ): Promise<DecryptedAttachments | null> => {
    const fieldIds = Object.keys(urls)
    if (!areAttachmentFieldIdsValid(fieldIds, filenames)) return null
    const { allowedHosts, timeout, maxContentLength } =
      this.attachmentDownloadOptions
    if (
      !fieldIds.every((fieldId) =>
        isAllowedAttachmentUrl(urls[fieldId], allowedHosts)
      )
    ) {
      return null
    }
    const attachments: DecryptedAttachments = {}
    try {
      await Promise.all(
        fieldIds.map(async (fieldId) => {
          const { data } = await axios.get<EncryptedAttachmentContent>(
            urls[fieldId],
            {
              responseType: 'json',
              maxRedirects: 0,
              timeout: timeout ?? DEFAULT_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
              maxContentLength:
                maxContentLength ?? DEFAULT_ATTACHMENT_MAX_CONTENT_LENGTH,
            }
          )
          const content = await this.decryptFile(
            secretKey,
            convertEncryptedAttachmentToFileContent(data)
          )
          if (!content) throw new AttachmentDecryptionError()
          attachments[fieldId] = { filename: filenames[fieldId], content }
        })
      )
    } catch {
      return null
    }
    return attachments
  }

  /**
   * Generates a new keypair for encryption.
   * @returns The generated keypair.
   */
  generate = generateKeypair

  /**
   * Encrypt given binary file with a unique keypair for each submission.
   * @param binary The file to encrypt, should be a blob that is converted to Uint8Array binary
   * @param publicKey The base-64 encoded public key
   * @returns Promise holding the encrypted file
   * @throws error if any of the encrypt methods fail
   */
  encryptFile = async (
    binary: Uint8Array,
    publicKey: string
  ): Promise<EncryptedFileContent> => {
    const fileKeypair = this.generate()
    const nonce = nacl.randomBytes(24)
    return {
      //! NOTE: submissionPublicKey here is a misnomer as a new keypair is generated per file.
      // The naming is only retained for backward-compatibility purposes.
      submissionPublicKey: fileKeypair.publicKey,
      nonce: encodeBase64(nonce),
      binary: nacl.box(
        binary,
        nonce,
        decodeBase64(publicKey),
        decodeBase64(fileKeypair.secretKey)
      ),
    }
  }

  /**
   * Decrypt the given encrypted file content.
   * @param secretKey Secret key as a base-64 string
   * @param encrypted Object returned from encryptFile function
   * @param encrypted.submissionPublicKey The file's public key as a base-64 string
   * @param encrypted.nonce The nonce as a base-64 string
   * @param encrypted.blob The encrypted file as a Blob object
   */
  decryptFile = async (
    secretKey: string,
    {
      submissionPublicKey: filePublicKey,
      nonce,
      binary: encryptedBinary,
    }: EncryptedFileContent
  ): Promise<Uint8Array | null> => {
    return nacl.box.open(
      encryptedBinary,
      decodeBase64(nonce),
      decodeBase64(filePublicKey),
      decodeBase64(secretKey)
    )
  }
}
