export type PackageInitParams = {
  /** base64 secret key for signing webhooks. If provided, enables generating signature and headers to authenticate webhook data. */
  webhookSecretKey?: string
  /** If provided, enables the usage of the verification module. */
  verificationOptions?: VerificationOptions
  /** Initializes public key used for verifying and decrypting in this package. If not given, will default to "production". */
  mode?: PackageMode
  /** Restricts where `decryptWithAttachments` may download attachments from. */
  attachmentDownloadOptions?: AttachmentDownloadOptions
}

export type AttachmentDownloadOptions = {
  /**
   * Hostnames attachments may be downloaded from. An entry of the form
   * `*.example.com` matches any subdomain of `example.com`. Defaults to
   * Amazon S3 hostnames, which FormSG uses for attachment downloads.
   */
  allowedHosts?: string[]
  /** Download timeout in milliseconds. Defaults to 30 seconds. */
  timeout?: number
  /** Maximum download size in bytes. Defaults to 32 MiB. */
  maxContentLength?: number
}

// A field type available in FormSG as a string
export type FieldType =
  | 'section'
  | 'radiobutton'
  | 'dropdown'
  | 'checkbox'
  | 'nric'
  | 'email'
  | 'table'
  | 'number'
  | 'rating'
  | 'yes_no'
  | 'decimal'
  | 'textfield' // Short Text
  | 'textarea' // Long Text
  | 'attachment'
  | 'date'
  | 'mobile'
  | 'homeno'
  | 'statement'
  | 'image'
  | 'country_region'
  | 'uen'
  | 'children'
  | 'address'
  | 'signature'

// Represents form field responses in a form.
export type FormField = {
  _id: string
  question: string
  fieldType: FieldType
  isHeader?: boolean
  signature?: string
} & (
  | { answer: string; answerArray?: never }
  | { answer?: never; answerArray: string[] | string[][] }
)

// Represents form field responses in a form.
export type FormFieldsV3 = Record<
  string,
  {
    fieldType: FieldType
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    answer: any // too complex to represent here
  }
>

// Encrypted basestring containing the submission public key,
// nonce and encrypted data in base-64.
// A string in the format of
// <SubmissionPublicKey>;<Base64Nonce>:<Base64EncryptedData>
export type EncryptedContent = string

export type EncryptedContentV3 = {
  submissionPublicKey: string
  submissionSecretKey: string
  encryptedContent: EncryptedContent
  encryptedSubmissionSecretKey: EncryptedContent
}

// Records containing a map of field IDs to URLs where encrypted
// attachments can be downloaded.
export type EncryptedAttachmentRecords = Record<string, string>

export interface DecryptParams {
  encryptedContent: EncryptedContent
  version: number
  verifiedContent?: EncryptedContent
  attachmentDownloadUrls?: EncryptedAttachmentRecords
}

export interface DecryptParamsV3 {
  encryptedContent: EncryptedContent
  encryptedSubmissionSecretKey: EncryptedContent
  verifiedContent?: EncryptedContent
  version: number
}

export type DecryptedContent = {
  responses: FormField[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  verified?: Record<string, any>
}

export type DecryptedContentV3 = {
  submissionSecretKey: string
  responses: FormFieldsV3
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  verified?: Record<string, any>
}

export type DecryptedFile = {
  filename: string
  content: Uint8Array
}

// Records containing a map of field IDs to DecryptedFiles.
export type DecryptedAttachments = Record<string, DecryptedFile>

export type DecryptedContentAndAttachments = {
  content: DecryptedContent
  attachments: DecryptedAttachments
}

export type EncryptedFileContent = {
  submissionPublicKey: string
  nonce: string
  binary: Uint8Array
}

export type EncryptedAttachmentContent = {
  encryptedFile: {
    submissionPublicKey: string
    nonce: string
    binary: string
  }
}

// A base-64 encoded cryptographic keypair suitable for curve25519.
export type Keypair = {
  publicKey: string
  secretKey: string
}

export type PackageMode = 'staging' | 'production' | 'development' | 'test'

export type VerificationOptions = {
  publicKey?: string
  secretKey?: string
  transactionExpiry?: number
}

// A verified answer contains a field ID and answer
export type VerifiedAnswer = {
  fieldId: string
  answer: string
}

// Add the transaction ID and form ID to a VerifiedAnswer to obtain a signature
export type VerificationSignatureOptions = VerifiedAnswer & {
  transactionId: string
  formId: string
}

// Creating a basestring requires the epoch in addition to signature requirements
export type VerificationBasestringOptions = VerificationSignatureOptions & {
  time: number
}

// Authenticate a VerifiedAnswer with a signatureString and epoch
export type VerificationAuthenticateOptions = VerifiedAnswer & {
  signatureString: string
  submissionCreatedAt: number
}
