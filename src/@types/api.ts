import { BytesWritten } from 'i2c-bus'
import { REG } from './registry'

export interface API {
  measure: (pin?: number) => Promise<{ [key: string]: number } | number>
  setSignalRateLimit: (
    limit_Mcps: number,
    pin?: number
  ) => Promise<{ [key: string]: BytesWritten } | BytesWritten | void>
  getSignalRateLimit: (pin?: number) => Promise<number | { [key: string]: number }>
  getMeasurementTimingBudget: (pin?: number) => Promise<number | { [key: string]: number }>
  setMeasurementTimingBudget: (budget_us: number, pin?: number) => Promise<void>
  getVcselPulsePeriod: (type: number, pin?: number) => Promise<{ [key: string]: number } | number>
  setVcselPulsePeriod: (type: 'pre' | 'final', period_pclks: 8 | 10 | 12 | 14 | 16 | 18, pin?: number) => Promise<void>
  performSingleRefCalibration: (vhv_init_byte: number, pin?: number) => Promise<void>
  io: {
    writeReg: (register: REG, value: number, isReg16: boolean, addr: number) => Promise<BytesWritten>
    writeMulti: (register: REG, array: Buffer, addr: number) => Promise<BytesWritten>
    readReg: (register: REG, isReg16: boolean, addr: number) => Promise<number>
    readMulti: (register: REG, length: number, addr: number) => Promise<Buffer>
  }
}
