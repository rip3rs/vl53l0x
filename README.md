# vl53l0x

A Node.js library for [a vl53l0x proximity sensor](https://amzn.to/2AP12Yw).

**NOTE:**
This package addresses the issue of adding multiple vl53l0x on one device. Please read below how to.

**NOTE:**

I honestly have very little knowledge of GPIO and hardware programming.
This is a fork from [https://github.com/williamkapke/vl53l0x ](https://github.com/williamkapke/vl53l0x)

I did this to try and understand a bit more how to develop nodejs -> sensors apis.
and to typescript the hell out of it!

[![vl53l0x](https://raw.githubusercontent.com/rip3rs/vl53l0x/master/vl53l0x.jpg)](https://amzn.to/2AP12Yw)

## Install

From: https://www.npmjs.com/package/i2c-bus#installation
<br/>
The way in which I2C is configured varies from board to board. Sometimes no
configuration is required, but sometimes it is:

- [Configuring I2C on the Raspberry Pi](doc/raspberry-pi-i2c.md)
- [Configuring Software I2C on the Raspberry Pi](doc/raspberry-pi-software-i2c.md)
  - Consider software I2C when there are issues communicating with a device on a Raspberry Pi

`npm install ts-vl53l0x`

## Use

## Normal single sensor

```typescript
import VL53L0X from 'ts-vl53l0x'

const vl53l0x = new VL53L0X()

const init = async () => {
  await vl53l0x.init()

  while (true) {
    console.log(await vl53l0x.api.measure())

    // output: { '0': 8191 }
  }
}

init()
```

## Multiple sensors

```typescript
import VL53L0X from 'ts-vl53l0x'

const arrayOfSensors = [
  [17, 0x30],
  [22, 0x31],
]

const vl53l0x = new VL53L0X(1, {}, arrayOfSensors)

const init = async () => {
  await vl53l0x.init()

  while (true) {
    console.log(await vl53l0x.api.measure())
    // output: { '17': 8191, '22': 8191 }

    console.log(await vl53l0x.api.measure(17))
    // output: { '17': 8191 }

    console.log(await vl53l0x.api.measure(22))
    // output: { '22': 8191 }
  }
}

init()
```

## Interface

### new VL53L0X(bus = 1, opts?: OPTS | Record<string, never>, address?: [[pin: number, address: number]] | number)

**address**

For multiple sensors, please use `XSHUT` and define the pin within the array:

```typescript
const arrayOfSensors = [
  [
    17, //pin
    0x30, // address to command
  ],
]
```

### OPTS

```typescript
  signalRateLimit?: number
  vcselPulsePeriod?: {
    pre: 12 | 14 | 16 | 18
    final: 12 | 14 | 16 | 18
  }
  measurementTimingBudget?: number
```

### vl53l0x.init(): Promise<API>

### vl53l0x.api: API

### API

```typescript
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
```

# References

https://www.st.com/resource/en/datasheet/vl53l0x.pdf

# License

MIT
