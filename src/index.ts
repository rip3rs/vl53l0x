import { API } from '#types/api'
import { OPTS } from '#types/options'
import { REG, tuning } from '#types/registry'
import { timeoutMicrosecondsToMclks } from '@utils/calcs'
import { encodeTimeout, encodeVcselPeriod } from '@utils/encode-decode'
import { BytesWritten } from 'i2c-bus'
import I2CCore from './I2C-core'
export default class VL53L0X extends I2CCore {
  constructor(bus = 1, opts?: null | OPTS, address?: number[][] | number) {
    super(bus, opts, address)
  }

  public async init(): Promise<API> {
    await this._setupProviderModule()

    for (const pin of Object.keys(this._addresses)) {
      if (this._addresses[pin].gpio) {
        await this._gpioWrite(this._addresses[pin].gpio, 1)
      }

      await this._setup(parseInt(pin))
    }

    return this.api
  }

  private async _setup(pin: number): Promise<void> {
    try {
      await this._writeReg(REG.I2C_SLAVE_DEVICE_ADDRESS, this._addresses[pin].addr, false, REG.I2C_DEFAULT_ADDR)
      // "Set I2C standard mode"
      await this._writeReg(REG.I2C_STANDARD_MODE, REG.SYSRANGE_START, false, this._addresses[pin].addr)
      await this._writeReg(
        REG.MSRC_CONFIG_CONTROL,
        (await this._readReg(REG.MSRC_CONFIG_CONTROL, false, this._addresses[pin].addr)) | 0x12,
        false,
        this._addresses[pin].addr
      )
      await this._setSignalRateLimit(0.25, pin)
      await this._writeReg(REG.SYSTEM_SEQUENCE_CONFIG, 0xff, false, this._addresses[pin].addr)
      await this._writeReg(0xff, REG.SYSTEM_SEQUENCE_CONFIG, false, this._addresses[pin].addr)
      await this._writeReg(REG.DYNAMIC_SPAD_REF_EN_START_OFFSET, REG.SYSRANGE_START, false, this._addresses[pin].addr)
      await this._writeReg(REG.DYNAMIC_SPAD_NUM_REQUESTED_REF_SPAD, 0x2c, false, this._addresses[pin].addr)
      await this._writeReg(0xff, REG.SYSRANGE_START, false, this._addresses[pin].addr)
      await this._writeReg(REG.GLOBAL_CONFIG_REF_EN_START_SELECT, 0xb4, false, this._addresses[pin].addr)

      const spadInfo = await this._getSpadInfo(this._addresses[pin].addr)
      const spadMap = await this._readMulti(REG.GLOBAL_CONFIG_SPAD_ENABLES_REF_0, 6, this._addresses[pin].addr)
      const firstSpadToEnable = spadInfo.aperture ? 12 : 0 // 12 is the first aperture spad
      let spads_enabled = 0

      for (let i = 0; i < 48; i++) {
        if (i < firstSpadToEnable || spads_enabled === spadInfo.count) {
          spadMap[1 + Math.floor(i / 8)] &= ~(1 << i % 8)
        } else if (((spadMap[1 + Math.floor(i / 8)] >> i % 8) & 0x1) > 0) {
          spads_enabled++
        }
      }

      await this._writeMulti(REG.GLOBAL_CONFIG_SPAD_ENABLES_REF_0, spadMap, this._addresses[pin].addr)

      for (let i = 0; i < tuning.length; i++) {
        await this._writeReg(tuning[i], tuning[++i], false, this._addresses[pin].addr)
      }

      await this._writeReg(
        REG.SYSTEM_INTERRUPT_CONFIG_GPIO,
        REG.SYSTEM_INTERMEASUREMENT_PERIOD,
        false,
        this._addresses[pin].addr
      )

      await this._writeReg(
        REG.GPIO_HV_MUX_ACTIVE_HIGH,
        (await this._readReg(REG.GPIO_HV_MUX_ACTIVE_HIGH, false, this._addresses[pin].addr)[0]) & ~0x10,
        false,
        this._addresses[pin].addr
      )

      await this._writeReg(REG.SYSTEM_INTERRUPT_CLEAR, REG.SYSTEM_SEQUENCE_CONFIG, false, this._addresses[pin].addr)

      this._addresses[pin].timingBudget = await this._getMeasurementTimingBudget(pin)

      // "Disable MSRC and TCC by default"
      // MSRC = Minimum Signal Rate Check
      // TCC = Target CentreCheck
      await this._writeReg(REG.SYSTEM_SEQUENCE_CONFIG, 0xe8, false, this._addresses[pin].addr)

      //VL53L0X_SetSequenceStepEnable()
      // "Recalculate timing budget"
      await this._setMeasurementTimingBudget(this._addresses[pin].timingBudget, pin)

      // VL53L0X_perform_vhv_calibration()
      await this._writeReg(REG.SYSTEM_SEQUENCE_CONFIG, REG.SYSTEM_SEQUENCE_CONFIG, false, this._addresses[pin].addr)

      await this._performSingleRefCalibration(0x40, pin)

      await this._writeReg(REG.SYSTEM_SEQUENCE_CONFIG, 0x02, false, this._addresses[pin].addr)

      await this._performSingleRefCalibration(0x00, pin)

      // "restore the previous Sequence Config"
      await this._writeReg(REG.SYSTEM_SEQUENCE_CONFIG, 0xe8, false, this._addresses[pin].addr)
    } catch (error) {
      console.error(error)
      throw new Error('INIT ERROR')
    }

    this._initialOptionsSetup(pin)
  }

  private async _initialOptionsSetup(pin: number): Promise<void> {
    // try {
    //   if (this._options.signalRateLimit) {
    //     await this._setSignalRateLimit(this._options.signalRateLimit, pin)
    //   }
    // } catch (error) {
    //   console.error(error)
    //   throw new Error('set: setSignalRateLimit ERROR')
    // }
    // try {
    //   if (this._options.measurementTimingBudget) {
    //     await this._setMeasurementTimingBudget(this._options.measurementTimingBudget, pin)
    //   }
    // } catch (error) {
    //   console.error(error)
    //   throw new Error('set: setMeasurementTimingBudget ERROR')
    // }
    // try {
    //   if (this._options.vcselPulsePeriod && this._options.vcselPulsePeriod.pre) {
    //     await this._setVcselPulsePeriod('pre', this._options.vcselPulsePeriod.pre, pin)
    //   }
    // } catch (error) {
    //   console.error(error)
    //   throw new Error('set: setVcselPulsePeriod PRE ERROR')
    // }
    // try {
    //   if (this._options.vcselPulsePeriod && this._options.vcselPulsePeriod.final) {
    //     await this._setVcselPulsePeriod('final', this._options.vcselPulsePeriod.final, pin)
    //   }
    // } catch (error) {
    //   console.error(error)
    //   throw new Error('set: setVcselPulsePeriod final ERROR')
    // }
  }

  private async _setMeasurementTimingBudget(budget_us: number, pin?: number): Promise<void> {
    if (budget_us < 20000) {
      throw new Error('budget below MinTimingBudget')
    }

    if (pin) {
      this._setMeasurementTimingBudgetFn(budget_us, pin)
    } else {
      for (const p of Object.keys(this._addresses)) {
        this._setMeasurementTimingBudgetFn(budget_us, parseInt(p))
      }
    }
  }

  private async _setMeasurementTimingBudgetFn(budget_us: number, pin: number): Promise<void> {
    // 1320 + 960  : start & end overhead values
    const budget = await this._getBudget(1320 + 960, this._addresses[pin].addr)
    console.log(budget)
    let used_budget_us = budget.value

    if (budget.enables.final_range) {
      used_budget_us += 550 // FinalRangeOverhead

      if (used_budget_us > budget_us) {
        throw new Error('Requested timeout too big.')
      }

      const final_range_timeout_us = budget_us - used_budget_us
      // set_sequence_step_timeout()
      let final_range_timeout_mclks = timeoutMicrosecondsToMclks(
        final_range_timeout_us,
        budget.timeouts.final_range_vcsel_period_pclks
      )

      if (budget.enables.pre_range) {
        final_range_timeout_mclks += budget.timeouts.pre_range_mclks
      }

      await this._writeReg(
        REG.FINAL_RANGE_CONFIG_TIMEOUT_MACROP_HI,
        encodeTimeout(final_range_timeout_mclks),
        true,
        this._addresses[pin].addr
      )

      this._addresses[pin].timingBudget = budget_us // store for internal reuse
    }
  }

  private async _getMeasurementTimingBudget(pin?: number): Promise<number | { [key: string]: number }> {
    const toReturn = {}

    if (pin) {
      // 1920 + 960 : start & end overhead values
      const budget = await this._getBudget(1920 + 960, this._addresses[pin].addr)

      if (budget.enables.final_range) {
        return budget.value + budget.timeouts.final_range_us + 550 //FinalRangeOverhead
      }

      return budget.value
    } else {
      for (const p of Object.keys(this._addresses)) {
        const budget = await this._getBudget(1920 + 960, this._addresses[p].addr)

        if (budget.enables.final_range) {
          toReturn[p] = budget.value + budget.timeouts.final_range_us + 550 //FinalRangeOverhead
        } else {
          toReturn[p] = budget.value
        }
      }
    }

    return toReturn
  }

  private async _setSignalRateLimit(
    limit_Mcps: number,
    pin?: number
  ): Promise<{ [key: string]: BytesWritten } | BytesWritten | void> {
    const toReturn = {}

    // Q9.7 fixed point format (9 integer bits, 7 fractional bits)
    if (limit_Mcps < 0 || limit_Mcps > 511.99) {
      return
    }

    if (pin) {
      return await this._writeReg(
        REG.FINAL_RANGE_CONFIG_MIN_COUNT_RATE_RTN_LIMIT,
        limit_Mcps * (1 << 7),
        true,
        this._addresses[pin].addr
      )
    } else {
      for (const p of Object.keys(this._addresses)) {
        toReturn[p] = await this._writeReg(
          REG.FINAL_RANGE_CONFIG_MIN_COUNT_RATE_RTN_LIMIT,
          limit_Mcps * (1 << 7),
          true,
          this._addresses[p].addr
        )
      }

      return toReturn
    }
  }

  private async _getSignalRateLimit(pin?: number): Promise<number | { [key: string]: number }> {
    const toReturn = {}

    if (pin) {
      return (
        (await this._readReg(REG.FINAL_RANGE_CONFIG_MIN_COUNT_RATE_RTN_LIMIT, true, this._addresses[pin].addr)) /
        (1 << 7)
      )
    } else {
      for (const p of Object.keys(this._addresses)) {
        toReturn[p] =
          (await this._readReg(REG.FINAL_RANGE_CONFIG_MIN_COUNT_RATE_RTN_LIMIT, true, this._addresses[p].addr)) /
          (1 << 7)
      }

      return toReturn
    }
  }

  private async _getRangeMillimeters(pin: number | string): Promise<number> {
    await this._writeReg(REG.SYSRANGE_START, REG.SYSTEM_SEQUENCE_CONFIG, false, this._addresses[pin].addr)
    const toReturn = await this._readReg(REG.RESULT_RANGE, true, this._addresses[pin].addr)
    await this._writeReg(REG.SYSTEM_INTERRUPT_CLEAR, REG.SYSTEM_SEQUENCE_CONFIG, false, this._addresses[pin].addr)

    return toReturn
  }

  private async _measure(pin?: number): Promise<{ [key: string]: number } | number> {
    const toReturn = {}

    if (pin) {
      if (this._addresses[pin]) {
        toReturn[pin] = await this._getRangeMillimeters(pin)
      } else {
        throw new Error(
          `Invalid pin number. Available Pins: [${Object.keys(this._addresses).map((pin) => '(' + pin + ')')}]`
        )
      }
    } else {
      for (const p of Object.keys(this._addresses)) {
        toReturn[p] = await this._getRangeMillimeters(p)
      }
    }

    return toReturn
  }

  /**
   * Valid values are (even numbers only):
   * pre:  12 to 18 (initialized default: 14)
   * final: 8 to 14 (initialized default: 10)
   *
   * @param {('pre' | 'final')} type
   * @param {number} period_pclks
   * @return {*}  {Promise<void>}
   * @memberof VL53L0X
   */
  private async _setVcselPulsePeriod(
    type: 'pre' | 'final',
    period_pclks: 8 | 10 | 12 | 14 | 16 | 18,
    pin?: number
  ): Promise<void> {
    if ((type !== 'pre' && type !== 'final') || (type !== 'final' && type !== 'pre')) {
      throw new Error('Invlaid type')
    }

    if (pin) {
      await this._setVcselPulsePeriodFn(type, period_pclks, pin)
    } else {
      for (const p of Object.keys(this._addresses)) {
        await this._setVcselPulsePeriodFn(type, period_pclks, parseInt(p))
      }
    }
  }

  private async _setVcselPulsePeriodFn(
    type: 'pre' | 'final',
    period_pclks: 8 | 10 | 12 | 14 | 16 | 18,
    pin: number
  ): Promise<void> {
    const vcsel_period_reg = encodeVcselPeriod(period_pclks)
    const sequence = await this._getSequenceSteps(this._addresses[pin].addr)
    if (type === 'pre') {
      const register = { 12: 0x18, 14: 0x30, 16: 0x40, 18: 0x50 }

      if (!register[period_pclks]) {
        throw new Error('invalid PRE period_pclks value')
      }

      await this._writeReg(register[period_pclks], 0x18, false, this._addresses[pin].addr)
      await this._writeReg(REG.PRE_RANGE_CONFIG_VALID_PHASE_LOW, 0x08, false, this._addresses[pin].addr)
      await this._writeReg(REG.PRE_RANGE_CONFIG_VCSEL_PERIOD, vcsel_period_reg, false, this._addresses[pin].addr)

      const new_pre_range_timeout_mclks = timeoutMicrosecondsToMclks(sequence.timeouts.pre_range_us, period_pclks) // set_sequence_step_timeout() - (SequenceStepId == VL53L0X_SEQUENCESTEP_PRE_RANGE)

      await this._writeReg(
        REG.PRE_RANGE_CONFIG_TIMEOUT_MACROP_HI,
        encodeTimeout(new_pre_range_timeout_mclks),
        true,
        this._addresses[pin].addr
      )

      const new_msrc_timeout_mclks = timeoutMicrosecondsToMclks(sequence.timeouts.msrc_dss_tcc_us, period_pclks) // set_sequence_step_timeout() - (SequenceStepId == VL53L0X_SEQUENCESTEP_MSRC)

      await await this._writeReg(
        REG.MSRC_CONFIG_TIMEOUT_MACROP,
        new_msrc_timeout_mclks > 256 ? 255 : new_msrc_timeout_mclks - 1,
        false,
        this._addresses[pin].addr
      )
    }

    if (type === 'final') {
      const args = {
        8: [0x10, 0x02, 0x0c, 0x30],
        10: [0x28, 0x03, 0x09, 0x20],
        12: [0x38, 0x03, 0x08, 0x20],
        14: [0x48, 0x03, 0x07, 0x20],
      }

      if (!args[period_pclks]) {
        throw new Error('invalid FINAL period_pclks value')
      }

      await this._writeReg(
        REG.FINAL_RANGE_CONFIG_VALID_PHASE_HIGH,
        args[period_pclks][0],
        false,
        this._addresses[pin].addr
      )
      await this._writeReg(REG.FINAL_RANGE_CONFIG_VALID_PHASE_LOW, 0x08, false, this._addresses[pin].addr)
      await this._writeReg(REG.GLOBAL_CONFIG_VCSEL_WIDTH, args[period_pclks][1], false, this._addresses[pin].addr)
      await this._writeReg(REG.ALGO_PHASECAL_CONFIG_TIMEOUT, args[period_pclks][2], false, this._addresses[pin].addr)
      await this._writeReg(0xff, 0x01, false, this._addresses[pin].addr)
      await this._writeReg(REG.ALGO_PHASECAL_LIM, args[period_pclks][3], false, this._addresses[pin].addr)
      await this._writeReg(0xff, 0x00, false, this._addresses[pin].addr)
      await this._writeReg(REG.FINAL_RANGE_CONFIG_VCSEL_PERIOD, vcsel_period_reg, false, this._addresses[pin].addr)

      const new_pre_range_timeout_mclks = timeoutMicrosecondsToMclks(sequence.timeouts.final_range_us, period_pclks)
      const pre_range = sequence.enables.pre_range ? sequence.timeouts.pre_range_mclks : 0
      const new_final_range_timeout_mclks = new_pre_range_timeout_mclks + pre_range // set_sequence_step_timeout() - (SequenceStepId == VL53L0X_SEQUENCESTEP_FINAL_RANGE)

      await this._writeReg(
        REG.FINAL_RANGE_CONFIG_TIMEOUT_MACROP_HI,
        encodeTimeout(new_final_range_timeout_mclks),
        true,
        this._addresses[pin].addr
      )
    }

    await this._setMeasurementTimingBudget(this._addresses[pin].timingBudget, pin)

    const sequence_config = await this._readReg(REG.SYSTEM_SEQUENCE_CONFIG, false, this._addresses[pin].addr) // VL53L0X_perform_phase_calibration()
    await this._writeReg(REG.SYSTEM_SEQUENCE_CONFIG, 0x02, false, this._addresses[pin].addr)
    await this._performSingleRefCalibration(0x0, pin)
    await this._writeReg(REG.SYSTEM_SEQUENCE_CONFIG, sequence_config, false, this._addresses[pin].addr)
  }

  private async _performSingleRefCalibration(vhv_init_byte: number, pin?: number): Promise<void> {
    if (pin) {
      await this._writeReg(
        REG.SYSRANGE_START,
        REG.SYSTEM_SEQUENCE_CONFIG | vhv_init_byte,
        false,
        this._addresses[pin].addr
      ) // VL53L0X_REG_SYSRANGE_MODE_START_STOP
      await this._writeReg(REG.SYSTEM_INTERRUPT_CLEAR, REG.SYSTEM_SEQUENCE_CONFIG, false, this._addresses[pin].addr)
      await this._writeReg(REG.SYSRANGE_START, REG.SYSRANGE_START, false, this._addresses[pin].addr)
    } else {
      for (const p of Object.keys(this._addresses)) {
        await this._writeReg(
          REG.SYSRANGE_START,
          REG.SYSTEM_SEQUENCE_CONFIG | vhv_init_byte,
          false,
          this._addresses[p].addr
        ) // VL53L0X_REG_SYSRANGE_MODE_START_STOP
        await this._writeReg(REG.SYSTEM_INTERRUPT_CLEAR, REG.SYSTEM_SEQUENCE_CONFIG, false, this._addresses[p].addr)
        await this._writeReg(REG.SYSRANGE_START, REG.SYSRANGE_START, false, this._addresses[p].addr)
      }
    }
  }

  protected async _getVcselPulsePeriod(register: number, pin?: number): Promise<{ [key: string]: number } | number> {
    try {
      const toReturn = {}

      if (pin) {
        return ((await this._readReg(register, false, this._addresses[pin].addr)) + 1) << 1
      } else {
        for (const p of Object.keys(this._addresses)) {
          toReturn[p] = ((await this._readReg(register, false, this._addresses[p].addr)) + 1) << 1
        }
      }
    } catch (error) {
      console.error(error)
      throw new Error('run: _getSequenceStepEnables ERROR')
    }
  }

  public get api(): API {
    return {
      measure: this._measure.bind(this),
      setSignalRateLimit: this._setSignalRateLimit.bind(this),
      getSignalRateLimit: this._getSignalRateLimit.bind(this),
      getMeasurementTimingBudget: this._getMeasurementTimingBudget.bind(this),
      setMeasurementTimingBudget: this._setMeasurementTimingBudget.bind(this),
      getVcselPulsePeriod: this._getVcselPulsePeriod.bind(this),
      setVcselPulsePeriod: this._setVcselPulsePeriod.bind(this),
      performSingleRefCalibration: this._performSingleRefCalibration.bind(this),
      io: {
        writeReg: this._writeReg.bind(this),
        writeMulti: this._writeMulti.bind(this),
        readReg: this._readReg.bind(this),
        readMulti: this._readMulti.bind(this),
      },
    }
  }
}
