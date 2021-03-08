import { BytesWritten, openPromisified, PromisifiedBus } from 'i2c-bus'
import { REG } from '#types/registry'
import { IBudget } from '#types/budget'
import { decodeTimeout } from '@utils/encode-decode'
import { timeoutMclksToMicroseconds } from '@utils/calcs'
import { calcCommonBudget } from '@utils/budget'
import { ISequenceEnabled, ISequenceTimeouts } from '#types/sequence'
import { BinaryValue, Gpio } from 'onoff'
import { IAddresses } from '#types/addresses'
import { OPTS } from '#types/options'

export default class I2CCore {
  private _busModule: PromisifiedBus
  private _bus: number
  protected _options: OPTS = {
    signalRateLimit: 0.1,
    vcselPulsePeriod: {
      pre: 18,
      final: 14,
    },
    measurementTimingBudget: 400000,
  }
  protected _addresses: IAddresses = {}

  constructor(bus: number, opts?: OPTS | Record<string, never>, addresses?: number[][] | number) {
    this._bus = bus
    this._options = { ...this._options, ...opts }
    this._addressSetup(addresses)
  }

  protected _addressSetup(addresses: number[][] | number): void {
    if (!addresses) {
      this._addresses[99] = {
        addr: REG.I2C_DEFAULT_ADDR,
        timingBudget: -1,
      }
    } else if (addresses && typeof addresses === 'number') {
      this._addresses[99] = {
        addr: addresses,
        timingBudget: -1,
      }
    } else if (addresses && typeof addresses !== 'number' && addresses.length > 0) {
      for (const pin of addresses) {
        this._addresses[pin[0]] = {
          addr: pin[1],
          gpio: new Gpio(pin[0], 'out'),
          timingBudget: -1,
        }

        this._addresses[pin[0]].gpio.writeSync(0)
      }
    } else {
      throw new Error(`addresses can only be of undefined; number; [number, number]`)
    }
  }

  protected async _setupProviderModule(): Promise<void> {
    if (typeof this._bus !== 'number') {
      throw new Error(`Provider i2c-bus requires that bus be a number`)
    }

    try {
      this._busModule = await openPromisified(this._bus)
    } catch (error) {
      throw new Error(`openPromisified, ${error}`)
    }
  }

  protected async _gpioWrite(gpio: Gpio, value: BinaryValue): Promise<void> {
    return new Promise((resolve, reject) => {
      gpio.write(value, (err) => {
        if (err) reject(err)

        const timeout = setTimeout(() => {
          clearTimeout(timeout)
          resolve()
        })
      })
    })
  }

  protected async _scan(): Promise<number[]> {
    const scan = await this._busModule.scan()
    const toHexScane = scan.map((s) => '0x' + s.toString(16))

    console.log(toHexScane)

    return scan
  }

  protected get config(): any {
    return {
      i2c_bus: this._bus,
      devices: this._addresses,
      available_addresses: this._scan().then((res) => res),
    }
  }

  protected async _writeReg(register: REG, value: number, isReg16 = false, addr: number): Promise<BytesWritten> {
    try {
      const data: [REG, number?] = [register]

      if (isReg16) {
        data.push(...[value >> 8, value & 0xff])
      } else {
        data.push(value)
      }

      const buffer = Buffer.from(data)

      return this._write(buffer, addr)
    } catch (error) {
      throw error
    }
  }

  protected async _write(data: Buffer, addr: number): Promise<BytesWritten> {
    try {
      return await this._busModule.i2cWrite(addr, data.length, data)
    } catch (error) {
      throw error
    }
  }

  protected async _writeMulti(register: REG, array: Buffer, addr: number): Promise<BytesWritten> {
    try {
      return this._write(Buffer.alloc(array.length + 1, register), addr)
    } catch (error) {
      throw error
    }
  }

  protected async _read(register: REG, length: number, addr: number): Promise<Buffer> {
    try {
      await this._busModule.i2cWrite(addr, 1, Buffer.alloc(1, register)) // tell it the read index
      return await (await this._busModule.i2cRead(addr, length, Buffer.allocUnsafe(length))).buffer
    } catch (error) {
      throw error
    }
  }

  protected async _readReg(register: REG, isReg16 = false, addr: number): Promise<number> {
    try {
      if (isReg16) {
        const buffer = await this._read(register, 2, addr)
        return (buffer[0] << 8) | buffer[1]
      }

      return (await this._read(register, 1, addr))[0]
    } catch (error) {
      throw error
    }
  }

  protected async _readMulti(register: REG, length: number, addr: number): Promise<Buffer> {
    try {
      return await this._read(register, length, addr)
    } catch (error) {
      throw error
    }
  }

  protected async _getSpadInfo(addr?: number): Promise<{ count: number; aperture: boolean }> {
    try {
      await this._writeReg(REG.POWER_MANAGEMENT_GO1_POWER_FORCE, REG.SYSTEM_SEQUENCE_CONFIG, false, addr)
      await this._writeReg(0xff, REG.SYSTEM_SEQUENCE_CONFIG, false, addr)
      await this._writeReg(REG.SYSRANGE_START, REG.SYSRANGE_START, false, addr)

      await this._writeReg(0xff, 0x06, false, addr)

      let x83 = await this._readReg(0x83, false, addr) // return hex(x83)
      await this._writeReg(0x83, x83 | REG.SYSTEM_INTERMEASUREMENT_PERIOD, false, addr)
      await this._writeReg(0xff, 0x07, false, addr)
      await this._writeReg(REG.SYSTEM_HISTOGRAM_BIN, REG.SYSTEM_SEQUENCE_CONFIG, false, addr)
      await this._writeReg(REG.POWER_MANAGEMENT_GO1_POWER_FORCE, REG.SYSTEM_SEQUENCE_CONFIG, false, addr)
      await this._writeReg(0x94, 0x6b, false, addr)
      await this._writeReg(0x83, REG.SYSRANGE_START, false, addr)

      await this._writeReg(0x83, REG.SYSTEM_SEQUENCE_CONFIG, false, addr)
      await this._writeReg(REG.SYSTEM_HISTOGRAM_BIN, REG.SYSRANGE_START, false, addr)
      await this._writeReg(0xff, 0x06, false, addr)
      x83 = await this._readReg(0x83, false, addr)
      await this._writeReg(0x83, x83 & ~REG.SYSTEM_INTERMEASUREMENT_PERIOD, false, addr)
      await this._writeReg(0xff, REG.SYSTEM_SEQUENCE_CONFIG, false, addr) // select collection 1
      await this._writeReg(REG.SYSRANGE_START, REG.SYSTEM_SEQUENCE_CONFIG, false, addr) // kinda like read-only=true?
      await this._writeReg(0xff, REG.SYSRANGE_START, false, addr) // always set back to the default collection
      await this._writeReg(REG.POWER_MANAGEMENT_GO1_POWER_FORCE, REG.SYSRANGE_START, false, addr)

      const tmp = await this._readReg(0x92, false, addr)

      return {
        count: tmp & 0x7f,
        aperture: Boolean((tmp >> 7) & REG.SYSTEM_SEQUENCE_CONFIG),
      }
    } catch (error) {
      console.error(error)
      throw new Error('SpadINFOs ERROR')
    }
  }

  private async _getSequenceStepEnables(addr?: number): Promise<ISequenceEnabled> {
    try {
      const sequence_config = await this._readReg(REG.SYSTEM_SEQUENCE_CONFIG, false, addr)

      return {
        msrc: (sequence_config >> 2) & 0x1,
        dss: (sequence_config >> 3) & 0x1,
        tcc: (sequence_config >> 4) & 0x1,
        pre_range: (sequence_config >> 6) & 0x1,
        final_range: (sequence_config >> 7) & 0x1,
      }
    } catch (error) {
      console.error(error)
      throw new Error('run: _getSequenceStepEnables ERROR')
    }
  }

  private async _getSequenceStepTimeouts(pre_range: number, addr?: number): Promise<ISequenceTimeouts> {
    try {
      const pre_range_vcsel_period_pclks = await this._getVcselPulsePeriodFn(REG.PRE_RANGE_CONFIG_VCSEL_PERIOD, addr)
      const msrc_dss_tcc_mclks = (await this._readReg(REG.MSRC_CONFIG_TIMEOUT_MACROP, false, addr)) + 1
      const pre_range_mclks = decodeTimeout(await this._readReg(REG.PRE_RANGE_CONFIG_TIMEOUT_MACROP_HI, true, addr))
      const final_range_vcsel_period_pclks = await this._getVcselPulsePeriodFn(
        REG.FINAL_RANGE_CONFIG_VCSEL_PERIOD,
        addr
      )
      const final_range_mclks =
        decodeTimeout(await this._readReg(REG.FINAL_RANGE_CONFIG_TIMEOUT_MACROP_HI, true, addr)) -
        (pre_range ? pre_range_mclks : 0)

      return {
        pre_range_vcsel_period_pclks,
        msrc_dss_tcc_mclks,
        msrc_dss_tcc_us: timeoutMclksToMicroseconds(msrc_dss_tcc_mclks, pre_range_vcsel_period_pclks),
        pre_range_mclks,
        pre_range_us: timeoutMclksToMicroseconds(pre_range_mclks, pre_range_vcsel_period_pclks),
        final_range_vcsel_period_pclks,
        final_range_mclks,
        final_range_us: timeoutMclksToMicroseconds(final_range_mclks, final_range_vcsel_period_pclks),
      }
    } catch (error) {
      console.error(error)
      throw new Error('run: _getSequenceStepTimeouts ERROR')
    }
  }

  protected async _getSequenceSteps(addr: number): Promise<{ enables: ISequenceEnabled; timeouts: ISequenceTimeouts }> {
    try {
      const enables = await this._getSequenceStepEnables(addr)
      const timeouts = await this._getSequenceStepTimeouts(enables.pre_range, addr)

      return {
        enables,
        timeouts,
      }
    } catch (error) {
      console.error(error)
      throw new Error('run: _getSequenceSteps ERROR')
    }
  }

  protected async _getBudget(v: number, addr?: number): Promise<IBudget> {
    try {
      const sequence = await this._getSequenceSteps(addr)
      return {
        enables: sequence.enables,
        timeouts: sequence.timeouts,
        value: calcCommonBudget(v, sequence.enables, sequence.timeouts),
      }
    } catch (error) {
      console.error(error)
      throw new Error('run: _getBudget ERROR')
    }
  }

  protected async _getVcselPulsePeriodFn(register: number, addr?: number): Promise<number> {
    return ((await this._readReg(register, false, addr)) + 1) << 1
  }
}
