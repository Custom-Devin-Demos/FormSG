import { cronPaymentConfig } from 'src/app/config/features/payment-cron.config'

import { isCronPaymentAuthValid } from '../auth.utils'

describe('auth.utils', () => {
  describe('isCronPaymentAuthValid', () => {
    const originalSecret = cronPaymentConfig.apiSecret

    afterEach(() => {
      cronPaymentConfig.apiSecret = originalSecret
    })

    it('should return true when header matches configured secret', () => {
      cronPaymentConfig.apiSecret = 'some-secret'
      expect(
        isCronPaymentAuthValid({
          'x-formsg-cron-payment-secret': 'some-secret',
        }),
      ).toBe(true)
    })

    it('should return false when header does not match configured secret', () => {
      cronPaymentConfig.apiSecret = 'some-secret'
      expect(
        isCronPaymentAuthValid({
          'x-formsg-cron-payment-secret': 'some-secreT',
        }),
      ).toBe(false)
      expect(
        isCronPaymentAuthValid({ 'x-formsg-cron-payment-secret': 'short' }),
      ).toBe(false)
      expect(isCronPaymentAuthValid({})).toBe(false)
    })

    it('should return false when secret is unset, even with an empty header', () => {
      cronPaymentConfig.apiSecret = ''
      expect(
        isCronPaymentAuthValid({ 'x-formsg-cron-payment-secret': '' }),
      ).toBe(false)
      expect(isCronPaymentAuthValid({})).toBe(false)
    })
  })
})
