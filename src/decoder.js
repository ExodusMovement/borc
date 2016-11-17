'use strict'

const ieee754 = require('ieee754')
const Bignumber = require('bignumber.js')

const parser = require('./decoder.asm')
const utils = require('./utils')
const SHIFT32 = require('./constants').SHIFT32

const MAX_SAFE_HIGH = 0x1fffff
const NEG_ONE = new Bignumber(-1)

const PARENT_ARRAY = 0
const PARENT_OBJECT = 1
const PARENT_MAP = 2
const PARENT_TAG = 3

class Decoder {
  constructor (size) {
    if (!size || size < 0x10000) {
      size = 0x10000
    }

    // Heap use to share the input with the parser
    this._heap = new ArrayBuffer(size)
    this._heap8 = new Uint8Array(this._heap)

    this._reset()

    // Initialize asm based parser
    this.parser = parser(global, {
      pushInt: this.pushInt.bind(this),
      pushInt32: this.pushInt32.bind(this),
      pushInt32Neg: this.pushInt32Neg.bind(this),
      pushInt64: this.pushInt64.bind(this),
      pushInt64Neg: this.pushInt64Neg.bind(this),
      pushFloat: this.pushFloat.bind(this),
      pushFloatSingle: this.pushFloatSingle.bind(this),
      pushFloatDouble: this.pushFloatDouble.bind(this),
      pushTrue: this.pushTrue.bind(this),
      pushFalse: this.pushFalse.bind(this),
      pushUndefined: this.pushUndefined.bind(this),
      pushNull: this.pushNull.bind(this),
      pushInfinity: this.pushInfinity.bind(this),
      pushInfinityNeg: this.pushInfinityNeg.bind(this),
      pushNaN: this.pushNaN.bind(this),
      pushNaNNeg: this.pushNaNNeg.bind(this),
      pushArrayStartFixed: this.pushArrayStartFixed.bind(this),
      pushArrayStartFixed32: this.pushArrayStartFixed32.bind(this),
      pushArrayStartFixed64: this.pushArrayStartFixed64.bind(this),
      pushObjectStartFixed: this.pushObjectStartFixed.bind(this),
      pushObjectStartFixed32: this.pushObjectStartFixed32.bind(this),
      pushObjectStartFixed64: this.pushObjectStartFixed64.bind(this),
      pushByteString: this.pushByteString.bind(this),
      pushUtf8String: this.pushUtf8String.bind(this)
    }, this._heap)
  }

  get _depth () {
    return this._parents.length
  }

  get _currentParent () {
    return this._parents[this._depth - 1]
  }

  get _ref () {
    return this._currentParent.ref
  }

  // Finish the current parent
  _closeParent () {
    return this._parents.pop()
  }

  // Reduce the expected length of the current parent by one
  _dec () {
    const p = this._currentParent

    // The current parent does not know the epxected child length
    if (p.length < 0) {
      return
    }

    p.length --

    // All children were seen, we can close the current parent
    if (p.length === 0) {
      this._closeParent()
    }
  }

  // Push any value to the current parent
  _push (val) {
    const p = this._currentParent

    switch (p.type) {
      case PARENT_ARRAY:
        this._ref.push(val)
        this._dec()
        break
      case PARENT_OBJECT:
        if (this._tmpKey) {
          this._ref[this._tmpKey] = val
          this._tmpKey = null
          this._dec()
        } else {
          this._tmpKey = val
          if (typeof this._tmpKey !== 'string') {
            // too bad, convert to a Map
            p.type = PARENT_MAP
            p.ref = utils.buildMap(p.ref)
          }
        }
        break
      case PARENT_MAP:
        if (this._tmpKey) {
          this._ref.set(this._tmpKey, val)
          this._tmpKey = null
          this._dec()
        } else {
          this._tmpKey = val
        }
        break
      case PARENT_TAG:
        // TODO:
        break
      default:
        throw new Error('Unkwon parent type')
    }
  }

  // Create a new parent in the parents list
  _createParent (obj, type, len) {
    this._push(obj)
    this._parents[this._depth] = {
      type: type,
      left: len,
      ref: obj
    }
  }

  // Reset all state back to the beginning, also used for initiatlization
  _reset () {
    this._res = []
    this._tmpKey = null
    this._parents = [{
      type: PARENT_ARRAY,
      len: -1,
      ref: this._res
    }]
  }

  // -- Interface to customize deoding behaviour

  pushInt (val) {
    this._push(val)
  }

  pushInt32 (f, g) {
    this._push(utils.buildInt32(f, g))
  }

  pushInt64 (f1, f2, g1, g2) {
    this._push(utils.buildInt64(f1, f2, g1, g2))
  }

  pushFloat (val) {
    this._push(val)
  }

  pushFloatSingle (a, b, c, d) {
    this._push(
      ieee754.read([a, b, c, d], 0, false, 23, 4)
    )
  }

  pushFloatDouble (a, b, c, d, e, f, g, h) {
    this._push(
      ieee754.read([a, b, c, d, e, f, g, h], 0, false, 52, 8)
    )
  }

  pushInt32Neg (f, g) {
    this._push(-1 - utils.buildInt32(f, g))
  }

  pushInt64Neg (f1, f2, g1, g2) {
    const f = utils.buildInt32(f1, f2)
    const g = utils.buildInt32(g1, g2)

    if (f > MAX_SAFE_HIGH) {
      this._push(
        NEG_ONE.sub(new Bignumber(f).times(SHIFT32).plus(g))
      )
    } else {
      this._push(-1 - ((f * SHIFT32) + g))
    }
  }

  pushTrue () {
    this._push(true)
  }

  pushFalse () {
    this._push(false)
  }

  pushNull () {
    this._push(null)
  }

  pushUndefined () {
    this._push(void 0)
  }

  pushInfinity () {
    this._push(Infinity)
  }

  pushInfinityNeg () {
    this._push(-Infinity)
  }

  pushNaN () {
    this._push(NaN)
  }

  pushNaNNeg () {
    this._push(-NaN)
  }

  pushArrayStartFixed (len) {
    this._createArrayStartFixed(len)
  }

  pushArrayStartFixed32 (len1, len2) {
    const len = utils.buildInt32(len1, len2)
    this._createArrayStartFixed(len)
  }

  pushArrayStartFixed64 (len1, len2, len3, len4) {
    const len = utils.buildInt64(len1, len2, len3, len4)
    this._createArrayStartFixed(len)
  }

  pushObjectStartFixed (len) {
    this._createObjectStartFixed(len)
  }

  pushObjectStartFixed32 (len1, len2) {
    const len = utils.buildInt32(len1, len2)
    this._createObjectStartFixed(len)
  }

  pushObjectStartFixed64 (len1, len2, len3, len4) {
    const len = utils.buildInt64(len1, len2, len3, len4)
    this._createObjectStartFixed(len)
  }

  pushByteString (start, end) {
    this._push(this._heap.slice(start, end + 1))
  }

  pushUtf8String (start, end) {
    this._push(
      (new Buffer(this._heap.slice(start, end + 1))).toString('utf8')
    )
  }

  _createObjectStartFixed (len) {
    this._createParent({}, PARENT_OBJECT, len)
  }

  _createArrayStartFixed (len) {
    this._createParent(new Array(len), PARENT_ARRAY, len)
  }

  _decode (input) {
    this._reset()
    this._heap8.set(input)
    const code = this.parser.parse(input.byteLength)

    if (code > 0) {
      throw new Error('Failed to parse')
    }
  }

  // -- Public Interface

  decodeFirst (input) {
    this._decode(input)

    return this._res[0]
  }

  decodeAll (input) {
    this._decode(input)

    return this._res
  }
}

Decoder.decode = function decode (input, enc) {
  if (typeof input === 'string') {
    input = new Buffer(input, enc || 'hex')
  }

  const dec = new Decoder()
  return dec.decodeFirst(input)
}

Decoder.decodeFirst = Decoder.decode

Decoder.decodeAll = function decode (input, enc) {
  if (typeof input === 'string') {
    input = new Buffer(input, enc || 'hex')
  }

  const dec = new Decoder()
  return dec.decodeAll(input)
}

module.exports = Decoder